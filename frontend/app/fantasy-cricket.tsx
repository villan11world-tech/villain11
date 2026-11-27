import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'villan.token';
type Match = { id: string; name?: string; series_name?: string; match_desc?: string; format?: string; status?: string; status_detail?: string; live?: boolean; starting_at?: string; venue?: string; team_a?: { name?: string; code?: string; logo?: string }; team_b?: { name?: string; code?: string; logo?: string }; scores?: any[]; note?: string };
type Player = { id: string; name: string; role: string; team_id?: string | number; credits: number; photo?: string; is_playing?: boolean | null; wicketkeeper?: boolean; is_keeper?: boolean };
type Contest = { id: string; name: string; entry_fee: number; prizes: number[]; max_entries: number; joined_count?: number; joined?: boolean; status?: string };
type FantasyTeam = { id: string; match_id: string; team_name: string; player_ids: string[]; captain_id: string; vice_captain_id: string; credits_used?: number };
type LeaderboardRow = { rank: number; team_id: string; team_name: string; points: number; players?: { player_id: string; name: string; base_points: number; multiplier: number; points: number }[] };
type MatchPoints = { match_status?: string; finished?: boolean; updated_at?: string; players?: { player_id: string; name: string; points: number }[] };

function isCompletedMatch(match: Match) {
  const value = String(match.status || '').toLowerCase();
  return /completed|complete|finished|result|abandoned|cancelled|canceled|no result/.test(value);
}

function apiPath(path: string) {
  const root = BASE.endsWith('/api') ? BASE : `${BASE}/api`;
  return `${root}${path}`;
}

export default function FantasyCricketScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'matches' | 'players' | 'contests' | 'teams'>('matches');
  const [status, setStatus] = useState<'all' | 'live' | 'upcoming' | 'completed'>('all');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'WK' | 'BAT' | 'AR' | 'BOWL'>('ALL');
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [captainId, setCaptainId] = useState('');
  const [viceCaptainId, setViceCaptainId] = useState('');
  const [teamName, setTeamName] = useState('My Fantasy Team');
  const [contests, setContests] = useState<Contest[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [matchPoints, setMatchPoints] = useState<MatchPoints | null>(null);
  const [leaderboards, setLeaderboards] = useState<Record<string, { leaderboard: LeaderboardRow[]; settled?: boolean; match_status?: string; updated_at?: string }>>({});
  const [leaderboardLoading, setLeaderboardLoading] = useState<Record<string, boolean>>({});
  const [lastMatchRefresh, setLastMatchRefresh] = useState<Date | null>(null);

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!BASE) throw new Error('Backend URL set nahi hai. EXPO_PUBLIC_BACKEND_URL configure karke app dobara build karein.');
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    let response: Response;
    try {
      response = await fetch(apiPath(path), {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
      });
    } catch (networkError: any) {
      throw new Error('Server se connection nahi ho pa raha. Internet aur backend URL check karein.');
    }
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw || 'Unexpected server response' }; }
    if (!response.ok) { const detail = Array.isArray(data?.detail) ? data.detail.map((item: any) => item?.msg || item?.message || JSON.stringify(item)).join(', ') : data?.detail; throw new Error(typeof detail === 'string' ? detail : (data?.message || `Request failed (${response.status})`)); }
    return data;
  }, []);

  const loadWallet = useCallback(async () => {
    try { const data = await request('/fantasy/wallet'); setBalance(Number(data.balance || 0)); }
    catch (e: any) { setError(e.message || 'Wallet load nahi hua'); }
  }, [request]);

  const loadMatches = useCallback(async (nextStatus = 'all', isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await request(`/fantasy/matches?status=${nextStatus}&days=30`);
      const rows = Array.isArray(data.matches) ? data.matches : Array.isArray(data.data?.matches) ? data.data.matches : Array.isArray(data.data) ? data.data : [];
      setMatches(rows);
      if (!rows.length && data.source_counts) {
        const counts = data.source_counts;
        const feedErrors = Array.isArray(data.feed_errors) && data.feed_errors.length ? ` API errors: ${data.feed_errors.join(' | ')}` : '';
        setError(`CricketLiveAPI feeds checked — Live: ${counts.live ?? 0}, Upcoming: ${counts.upcoming ?? 0}, Recent: ${counts.recent ?? 0}. No valid fixtures returned.${feedErrors}`);
      }
      setLastMatchRefresh(new Date());
    } catch (e: any) { setError(e.message || 'Matches load nahi hue'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [request]);

  useEffect(() => { loadMatches('all'); loadWallet(); }, [loadMatches, loadWallet]);

  useEffect(() => {
    if (tab !== 'matches') return;
    const timer = setInterval(() => loadMatches(status, true), 60000);
    return () => clearInterval(timer);
  }, [tab, status, loadMatches]);

  const loadTeams = useCallback(async (matchId?: string) => {
    try {
      const data = await request(`/fantasy/teams${matchId ? `?match_id=${encodeURIComponent(matchId)}` : ''}`);
      const rows = Array.isArray(data) ? data : Array.isArray(data?.teams) ? data.teams : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.teams) ? data.data.teams : [];
      setTeams(rows.map((team: any) => ({ ...team, id: String(team.id), match_id: String(team.match_id), player_ids: Array.isArray(team.player_ids) ? team.player_ids.map(String) : [] })));
    } catch (e: any) { setError(e.message || 'Teams load nahi hui'); }
  }, [request]);

  const loadMatchPoints = useCallback(async (matchId: string) => {
    try {
      const data = await request(`/fantasy/matches/${encodeURIComponent(matchId)}/points`);
      setMatchPoints(data);
    } catch (e: any) {
      // Live points may be temporarily unavailable before the provider publishes scorecards.
      console.warn('Fantasy points refresh failed:', e.message || e);
    }
  }, [request]);

  const loadLeaderboard = async (contestId: string) => {
    setLeaderboardLoading(prev => ({ ...prev, [contestId]: true }));
    try {
      const data = await request(`/fantasy/contests/${encodeURIComponent(contestId)}/leaderboard`);
      setLeaderboards(prev => ({ ...prev, [contestId]: data }));
      await loadWallet();
    } catch (e: any) {
      setError(e.message || 'Leaderboard load nahi hua');
    } finally {
      setLeaderboardLoading(prev => ({ ...prev, [contestId]: false }));
    }
  };

  useEffect(() => {
    const matchId = selectedMatch?.id;
    if (!matchId || (tab !== 'players' && tab !== 'contests')) return;
    loadMatchPoints(matchId);
    const finished = Boolean(matchPoints?.finished);
    if (finished) return;
    const isLive = Boolean(selectedMatch?.live);
    const timer = setInterval(() => loadMatchPoints(matchId), isLive ? 20000 : 60000);
    return () => clearInterval(timer);
  }, [selectedMatch?.id, selectedMatch?.live, matchPoints?.finished, tab, loadMatchPoints]);

  // Leaderboards refresh only when the user opens one; this avoids duplicate provider calls.


  const chooseMatch = async (match: Match) => {
    setSelectedMatch(match); setMatchPoints(null); setPlayers([]); setLoading(true); setError('');
    setSelectedIds([]); setCaptainId(''); setViceCaptainId(''); setRoleFilter('ALL');
    // Open the player screen immediately; network latency must not make the button appear dead.
    setTab('players');
    try {
      const data = await request(`/fantasy/matches/${encodeURIComponent(String(match.id))}/players`);
      const rawPlayers = Array.isArray(data?.players) ? data.players : Array.isArray(data?.data?.players) ? data.data.players : Array.isArray(data?.data) ? data.data : [];
      const normalized = rawPlayers.map((p: any) => {
        const keeper = Boolean(p.wicketkeeper || p.is_keeper || p.is_wicketkeeper || String(p.role || '').toLowerCase().includes('keeper') || String(p.role || '').toLowerCase().includes('wicket'));
        const roleText = String(p.role || p.position || '').toLowerCase();
        const role = keeper ? 'WK' : roleText.includes('allround') || roleText.includes('all round') ? 'AR' : roleText.includes('bowl') ? 'BOWL' : roleText === 'wk' ? 'WK' : roleText === 'ar' ? 'AR' : roleText === 'bowl' ? 'BOWL' : 'BAT';
        return { ...p, id: String(p.id ?? p.player_id), name: p.name || p.fullname || 'Player', role, wicketkeeper: keeper, is_keeper: keeper, credits: Number(p.credits ?? (role === 'AR' ? 9.5 : role === 'BAT' ? 9 : 8.5)), team_id: p.team_id ?? p.team ?? 'unknown' };
      }).filter((p: any) => p.id && p.id !== 'undefined');
      setPlayers(normalized);
      if (normalized.length < 11) setError('Is match ki official lineup mein abhi 11 players available nahi hain. Lineup publish hone ke baad dobara try karein.');
    } catch (e: any) { setError(e.message || 'Players load nahi hue'); }
    finally { setLoading(false); }
  };

  const pickedPlayers = useMemo(() => players.filter(p => selectedIds.includes(String(p.id))), [players, selectedIds]);
  const creditsUsed = useMemo(() => pickedPlayers.reduce((sum, p) => sum + Number(p.credits || 0), 0), [pickedPlayers]);
  const visiblePlayers = useMemo(() => roleFilter === 'ALL' ? players : players.filter(p => roleFilter === 'WK' ? Boolean(p.wicketkeeper || p.is_keeper || String(p.role).toUpperCase() === 'WK') : String(p.role).toUpperCase() === roleFilter), [players, roleFilter]);

  const togglePlayer = (player: Player) => {
    const id = String(player.id);
    if (player.is_playing === false && !selectedIds.includes(id)) { Alert.alert('Playing XI update', 'Yeh player confirmed playing XI mein nahi hai. Kisi playing player ko select karein.'); return; }
    if (selectedIds.includes(id)) {
      setSelectedIds(prev => prev.filter(x => x !== id));
      if (captainId === id) setCaptainId('');
      if (viceCaptainId === id) setViceCaptainId('');
      return;
    }
    if (selectedIds.length >= 11) { Alert.alert('Team full', 'Team mein exactly 11 players select karne hain.'); return; }
    const sameTeamCount = pickedPlayers.filter(p => String(p.team_id || 'unknown') === String(player.team_id || 'unknown')).length;
    if (sameTeamCount >= 7) { Alert.alert('Selection limit', 'Ek real team se maximum 7 players select kar sakte ho.'); return; }
    if (creditsUsed + Number(player.credits || 0) > 100) { Alert.alert('Credit limit', 'Team ke total credits 100 se zyada nahi ho sakte.'); return; }
    setSelectedIds(prev => [...prev, id]);
  };

  const createTeam = async () => {
    if (!selectedMatch) { setError('Pehle match select karein.'); return; }
    if (selectedIds.length !== 11) { setError(`Exactly 11 players select karein. Abhi ${selectedIds.length}/11 selected hain.`); return; }
    if (!pickedPlayers.some(p => Boolean(p.wicketkeeper || p.is_keeper || String(p.role).toUpperCase() === 'WK'))) { setError('Team mein kam se kam 1 wicketkeeper select karein.'); return; }
    if (!captainId || !viceCaptainId) { setError('Captain aur Vice-Captain dono select karein.'); return; }
    if (captainId === viceCaptainId) { setError('Captain aur Vice-Captain alag hone chahiye.'); return; }
    // Normalize every ID to a string: CricketLiveAPI may return numeric player IDs,
    // while the backend schema stores player_ids/captain_id/vice_captain_id as strings.
    const playerIds = selectedIds.map(id => String(id));
    const captain = String(captainId);
    const viceCaptain = String(viceCaptainId);
    if (new Set(playerIds).size !== 11 || !playerIds.includes(captain) || !playerIds.includes(viceCaptain)) {
      setError('11 alag players select karein aur Captain/VC ko unhi 11 mein se choose karein.');
      return;
    }

    setSavingTeam(true); setError('');
    try {
      const payload = {
        match_id: String(selectedMatch.id),
        team_name: teamName.trim() || 'My Fantasy Team',
        player_ids: playerIds,
        captain_id: captain,
        vice_captain_id: viceCaptain,
      };
      const result = await request('/fantasy/teams', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Treat any successful HTTP response as a save acknowledgement; backend
      // versions may return {team}, {data:{team}}, or a direct team object.
      if (result?.success === false || result?.error) {
        throw new Error(result?.detail || result?.message || result?.error || 'Server ne team save reject kar di.');
      }
      // Navigate immediately. A secondary GET must never block the screen change.
      setTab('contests');
      setContests([]);
      setError('Team save ho gayi. Ab contest join karein.');
      void loadTeams(String(selectedMatch.id));
      void loadContests(String(selectedMatch.id));
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : 'Team save nahi hui';
      setError(message);
    } finally { setSavingTeam(false); }
  };

  const loadContests = async (matchId: string) => {
    setLoading(true); setError('');
    try {
      const data = await request(`/fantasy/contests?match_id=${encodeURIComponent(matchId)}`);
      const rawContests = Array.isArray(data) ? data : Array.isArray(data?.contests) ? data.contests : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.contests) ? data.data.contests : [];
      const contestList: Contest[] = rawContests.map((c: any) => ({ ...c, id: String(c.id), entry_fee: Number(c.entry_fee || 0), prizes: Array.isArray(c.prizes) ? c.prizes : [], max_entries: Number(c.max_entries || 0) }));
      setContests(contestList);
      await loadTeams(matchId);

      await loadWallet();
    } catch (e: any) { setError(e.message || 'Contests load nahi hue'); }
    finally { setLoading(false); }
  };

  const joinContest = async (contest: Contest) => {
    if (!selectedMatch) return;
    if (!Number.isFinite(Number(contest.entry_fee)) || Number(contest.entry_fee) <= 0) { setError('Is contest ki entry fee valid nahi hai. Refresh karke dobara try karein.'); return; }
    const matchingTeams = teams.filter(t => t.match_id === selectedMatch.id);
    if (!matchingTeams.length) { Alert.alert('Team required', 'Pehle is match ke liye apni 11-player team create karo.'); setTab('players'); return; }
    const team = matchingTeams[0];
    Alert.alert('Join contest?', `${contest.name}\nEntry fee: ${contest.entry_fee} coins\nTop 3 prizes: 1st ${contest.prizes?.[0] ?? 0}, 2nd ${contest.prizes?.[1] ?? 0}, 3rd ${contest.prizes?.[2] ?? 0} coins\n\nTeam: ${team.team_name}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Join', onPress: async () => {
        setLoading(true); setError('');
        try {
          const data = await request(`/fantasy/contests/${encodeURIComponent(contest.id)}/join`, { method: 'POST', body: JSON.stringify({ team_id: team.id }) });
          if (typeof data?.wallet?.balance === 'number') setBalance(data.wallet.balance); else await loadWallet();
          Alert.alert('Contest joined', 'Contest entry confirm ho gayi. Entry fee Main Wallet se deduct kar di gayi hai.');
          if (selectedMatch) await loadContests(selectedMatch.id);
        } catch (e: any) { setError(e.message || 'Contest join nahi hua'); }
        finally { setLoading(false); }
      } },
    ]);
  };

  const openContests = (match: Match) => {
    // Synchronous UI navigation first; API requests run in the background.
    setSelectedMatch(match);
    setMatchPoints(null);
    setContests([]);
    setError('');
    setTab('contests');
    void loadContests(String(match.id));
    void loadMatchPoints(String(match.id));
  };
  const openMyTeams = () => { setTab('teams'); void loadTeams(); };

  const matchLabel = (m: Match) => `${m.team_a?.code || m.team_a?.name || 'Team A'} vs ${m.team_b?.code || m.team_b?.name || 'Team B'}`;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topbar}>
        <Pressable onPress={() => tab === 'matches' ? router.back() : setTab('matches')} style={styles.back}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.heading}>VILLAIN 11 FANTASY</Text><Text style={styles.subheading}>Create your XI · Join contests · Win rewards</Text></View>
        <View style={styles.wallet}><Ionicons name="gift" size={15} color="#FDE68A"/><Text style={styles.walletText}>{balance === null ? '—' : balance.toLocaleString('en-IN')}</Text></View>
      </View>
      <View style={styles.tabs}>
        {([{ id: 'matches', label: 'Matches' }, { id: 'players', label: 'Create XI' }, { id: 'contests', label: 'Contests' }, { id: 'teams', label: 'My Teams' }] as const).map(item => (
          <Pressable key={item.id} onPressIn={() => { if (item.id !== 'teams') setTab(item.id); }} onPress={() => item.id === 'teams' ? openMyTeams() : setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}><Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text></Pressable>
        ))}
      </View>
      {!!error && <Pressable onPress={() => setError('')} style={styles.errorBox}><Ionicons name="alert-circle" size={16} color="#FCA5A5"/><Text style={styles.errorText}>{error}</Text><Text style={styles.dismiss}>×</Text></Pressable>}
      {loading && <View style={styles.loading}><ActivityIndicator color="#34D399"/><Text style={styles.loadingText}>Loading...</Text></View>}

      {tab === 'matches' && <>
        <View style={styles.heroCard}><View style={styles.heroIcon}><Ionicons name="trophy" size={23} color="#FFFFFF"/></View><View style={{ flex: 1 }}><Text style={styles.heroEyebrow}>VILLAIN 11 • FANTASY ARENA</Text><Text style={styles.heroTitle}>Pick your team. Own the match.</Text><Text style={styles.heroSub}>Select 11 players · Set Captain & Vice-Captain · Track live points</Text></View></View>
        <View style={styles.filterRow}>{(['all', 'live', 'upcoming', 'completed'] as const).map(s => <Pressable key={s} onPress={() => { setStatus(s); loadMatches(s); }} style={[styles.filter, status === s && styles.filterActive]}><Text style={[styles.filterText, status === s && styles.filterTextActive]}>{s.toUpperCase()}</Text></Pressable>)}</View>
        <View style={styles.updatedRow}><Text style={styles.updatedText}>{lastMatchRefresh ? `Updated ${lastMatchRefresh.toLocaleTimeString()}` : 'Live fixtures and upcoming matches'}</Text><Pressable onPress={() => loadMatches(status, true)}><Ionicons name="refresh" size={17} color="#0F8B66"/></Pressable></View>
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadMatches(status, true)} tintColor="#34D399" />}>
          {matches.length === 0 && !loading ? <View style={styles.empty}><Ionicons name="trophy" size={36} color="#64748B"/><Text style={styles.emptyTitle}>No matches found</Text><Text style={styles.emptySub}>API feeds se abhi valid fixtures nahi mile. Upar feed counts dekhein aur refresh karein.</Text></View> : matches.map(m => (
            <View key={m.id} style={styles.matchCard}>
              <View style={styles.matchMeta}><Text style={styles.format}>{(m.format || 'CRICKET').toUpperCase()}</Text><Text style={[styles.status, m.live && styles.liveStatus]}>{m.live ? '● LIVE' : (m.status || 'UPCOMING').toUpperCase()}</Text></View>
              <Text style={styles.matchTitle}>{matchLabel(m)}</Text>
              <Text style={styles.matchSub}>{[m.series_name, m.match_desc].filter(Boolean).join(' · ') || m.name || 'Cricket match'}{m.starting_at ? `  ·  ${new Date(m.starting_at).toLocaleString()}` : ''}</Text>
              {!!m.scores?.length && <Text style={styles.score}>{m.scores.map(s => `${s.score || '—'}${s.wickets != null ? `/${s.wickets}` : ''}${s.overs ? ` (${s.overs})` : ''}`).join('   ·   ')}</Text>}
              <View style={styles.buttonRow}>
                {isCompletedMatch(m) ? (
                  <View style={[styles.primaryBtn, { backgroundColor: '#94A3B8', opacity: 0.8 }]}><Text style={styles.primaryText}>Match Completed</Text></View>
                ) : (
                  <Pressable style={styles.primaryBtn} onPress={() => chooseMatch(m)}><Text style={styles.primaryText}>Create Team</Text></Pressable>
                )}
                <Pressable style={styles.secondaryBtn} onPressIn={() => { setSelectedMatch(m); setContests([]); setError(''); setTab('contests'); }} onPress={() => openContests(m)}><Text style={styles.secondaryText}>View Contests</Text></Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      </>}

      {tab === 'players' && <ScrollView contentContainerStyle={styles.content}>
        {!selectedMatch ? <View style={styles.empty}><Text style={styles.emptyTitle}>Select a match first</Text><Pressable style={styles.primaryBtn} onPress={() => setTab('matches')}><Text style={styles.primaryText}>Browse matches</Text></Pressable></View> : <>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{matchLabel(selectedMatch)}</Text><Text style={styles.sectionSub}>{selectedIds.length}/11 players · {creditsUsed.toFixed(1)}/100 credits</Text></View>
          <TextInput value={teamName} onChangeText={setTeamName} placeholder="Team name" placeholderTextColor="#94A3B8" style={styles.input} maxLength={40}/>
          <View style={styles.roleFilters}>{(['ALL', 'WK', 'BAT', 'AR', 'BOWL'] as const).map(role => <Pressable key={role} onPress={() => setRoleFilter(role)} style={[styles.roleChip, roleFilter === role && styles.roleChipActive]}><Text style={[styles.roleChipText, roleFilter === role && styles.roleChipTextActive]}>{role === 'ALL' ? 'All' : role}</Text></Pressable>)}</View>
          {visiblePlayers.map(p => {
            const id = String(p.id); const picked = selectedIds.includes(id);
            return <Pressable key={id} onPress={() => togglePlayer(p)} style={[styles.playerRow, picked && styles.playerPicked]}>
              <View style={styles.playerAvatar}><Text style={styles.playerInitial}>{(p.name || '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.playerName}>{p.name}</Text><Text style={styles.playerMeta}>{p.role} · {p.credits} credits · {Number(matchPoints?.players?.find(x => String(x.player_id) === id)?.points ?? p.credits * 0).toFixed(1)} pts{p.is_playing === true ? ' · XI' : p.is_playing === false ? ' · Not in XI' : ''}</Text></View>
              <Pressable onPress={(event) => { event.stopPropagation(); if (!picked) { Alert.alert('Select player first', 'Player ko team mein add karo, phir Captain/VC set karo.'); return; } setCaptainId(id); }} style={[styles.captainBtn, captainId === id && styles.captainSelected]}><Text style={[styles.captainText, captainId === id && styles.captainTextSelected]}>C</Text></Pressable>
              <Pressable onPress={(event) => { event.stopPropagation(); if (!picked) { Alert.alert('Select player first', 'Player ko team mein add karo, phir Captain/VC set karo.'); return; } setViceCaptainId(id); }} style={[styles.captainBtn, viceCaptainId === id && styles.viceSelected]}><Text style={[styles.captainText, viceCaptainId === id && styles.captainTextSelected]}>VC</Text></Pressable>
              <Ionicons name={picked ? 'checkmark-circle' : 'add-circle-outline'} size={23} color={picked ? '#34D399' : '#64748B'} />
            </Pressable>;
          })}
          <Text style={styles.helper}>Player row tap karke add/remove karein. Right side C = Captain (2× points), VC = Vice-Captain (1.5× points).</Text>
          <Pressable disabled={savingTeam} style={[styles.primaryBtn, styles.fullBtn, savingTeam && { opacity: 0.5 }]} onPress={createTeam}><Text style={styles.primaryText}>{savingTeam ? 'Saving team...' : 'Save Team & View Contests'}</Text></Pressable>
        </>}
      </ScrollView>}

      {tab === 'contests' && <ScrollView contentContainerStyle={styles.content}>
        {!selectedMatch ? <View style={styles.empty}><Text style={styles.emptyTitle}>Choose a match to see contests</Text><Pressable style={styles.primaryBtn} onPress={() => setTab('matches')}><Text style={styles.primaryText}>Browse matches</Text></Pressable></View> : <>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{matchLabel(selectedMatch)}</Text><Text style={styles.sectionSub}>Contest entry fee Main Wallet se deduct hogi. Winners ko prize Main Wallet mein milega.</Text></View>
          <View style={styles.pointsCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointsTitle}>LIVE FANTASY POINTS</Text>
              <Text style={styles.pointsSub}>{matchPoints?.match_status ? `Match: ${String(matchPoints.match_status).toUpperCase()}` : 'Waiting for scorecard data'} · Auto refresh 20 sec live / 60 sec pre-match</Text>
              {!!matchPoints?.updated_at && <Text style={styles.pointsSub}>Updated: {new Date(matchPoints.updated_at).toLocaleTimeString()}</Text>}
            </View>
            <Pressable style={styles.pointsRefresh} onPress={() => loadMatchPoints(selectedMatch.id)}><Ionicons name="refresh" size={17} color="#D1FAE5" /></Pressable>
          </View>
          {contests.map(c => <View key={c.id} style={styles.contestCard}>
            <View style={{ flex: 1 }}><Text style={styles.contestTitle}>{c.name}</Text><Text style={styles.contestSub}>{c.joined_count || 0}/{c.max_entries} entries · 1st: {Number(c.prizes?.[0] || 0).toLocaleString()} · 2nd: {Number(c.prizes?.[1] || 0).toLocaleString()} · 3rd: {Number(c.prizes?.[2] || 0).toLocaleString()} coins</Text><Text style={styles.contestSub}>{c.joined ? 'Already joined' : `${c.entry_fee} coins entry fee`}</Text></View>
            <Pressable disabled={!!c.joined} onPress={() => joinContest(c)} style={[styles.joinBtn, !!c.joined && styles.joinDisabled]}><Text style={styles.joinText}>{c.joined ? 'Joined' : 'Join'}</Text></Pressable>
            <Pressable onPress={() => loadLeaderboard(c.id)} style={styles.leaderboardBtn}><Text style={styles.leaderboardBtnText}>{leaderboardLoading[c.id] ? '...' : 'Leaderboard'}</Text></Pressable>
            {!!leaderboards[c.id] && <View style={styles.leaderboardPanel}>
              <View style={styles.leaderboardHeader}><Text style={styles.leaderboardTitle}>LEADERBOARD</Text><Text style={styles.leaderboardState}>{leaderboards[c.id].settled ? 'SETTLED' : 'LIVE'}</Text></View>
              {(leaderboards[c.id].leaderboard || []).length === 0 ? <Text style={styles.pointsSub}>Abhi leaderboard entries nahi hain.</Text> : (leaderboards[c.id].leaderboard || []).slice(0, 10).map(row => (
                <View key={`${row.team_id}-${row.rank}`} style={styles.rankRow}>
                  <Text style={styles.rankNumber}>#{row.rank}</Text>
                  <Text numberOfLines={1} style={styles.rankTeam}>{row.team_name}</Text>
                  <Text style={styles.rankPoints}>{Number(row.points || 0).toFixed(1)} pts</Text>
                </View>
              ))}
              {!!leaderboards[c.id].updated_at && <Text style={styles.pointsSub}>Updated {new Date(leaderboards[c.id].updated_at).toLocaleTimeString()}</Text>}
            </View>}
          </View>)}
          {!contests.length && !loading && <Text style={styles.emptySub}>No contests available.</Text>}
          <Pressable style={styles.secondaryBtn} onPress={() => setTab('players')}><Text style={styles.secondaryText}>Create / Update Team</Text></Pressable>
        </>}
      </ScrollView>}

      {tab === 'teams' && <ScrollView contentContainerStyle={styles.content}>
        {teams.length === 0 ? <View style={styles.empty}><Ionicons name="people" size={34} color="#64748B"/><Text style={styles.emptyTitle}>No fantasy teams yet</Text><Pressable style={styles.primaryBtn} onPress={() => setTab('matches')}><Text style={styles.primaryText}>Create your first team</Text></Pressable></View> : teams.map(t => <View key={t.id} style={styles.matchCard}><Text style={styles.matchTitle}>{t.team_name}</Text><Text style={styles.matchSub}>Match ID: {t.match_id}</Text><Text style={styles.matchSub}>{t.player_ids.length}/11 players · {t.credits_used ?? '—'} credits</Text><Text style={styles.matchSub}>C: {t.captain_id} · VC: {t.vice_captain_id}</Text><Pressable style={styles.primaryBtn} onPress={() => { const m = matches.find(x => String(x.id) === String(t.match_id)); if (m) openContests(m); else { setSelectedMatch({ id: String(t.match_id), team_a: { name: 'Selected Match' }, team_b: {} }); setContests([]); setTab('contests'); void loadContests(String(t.match_id)); } }}><Text style={styles.primaryText}>View Contests</Text></Pressable></View>)}
      </ScrollView>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F7FC' },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E1E8F4' },
  back: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#EAF0FF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  heading: { color: '#172B4D', fontSize: 16, fontWeight: '900', letterSpacing: 0.7 }, subheading: { color: '#71809A', fontSize: 11, marginTop: 3 },
  wallet: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF5E8', borderWidth: 1, borderColor: '#F4DFB5', borderRadius: 13, paddingHorizontal: 11, paddingVertical: 9 }, walletText: { color: '#A66A12', fontWeight: '900', fontSize: 12 },
  tabs: { flexDirection: 'row', paddingHorizontal: 9, paddingVertical: 9, gap: 4, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E1E8F4' }, tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 }, tabActive: { backgroundColor: '#E9F0FF' }, tabText: { color: '#84938D', fontSize: 10, fontWeight: '800' }, tabTextActive: { color: '#2456C6' },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: 14, marginTop: 14, padding: 16, borderRadius: 19, backgroundColor: '#183B78', borderWidth: 1, borderColor: '#142F62' }, heroIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#2C58A8', alignItems: 'center', justifyContent: 'center' }, heroEyebrow: { color: '#C8D8FF', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, heroTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', marginTop: 3 }, heroSub: { color: '#E2EAFF', fontSize: 10, marginTop: 4, lineHeight: 15 },
  updatedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 2 }, updatedText: { color: '#75839A', fontSize: 10, fontWeight: '600' },
  content: { padding: 14, paddingBottom: 40, gap: 12 }, filterRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingVertical: 12 }, filter: { borderWidth: 1, borderColor: '#DCE4F2', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#FFFFFF' }, filterActive: { backgroundColor: '#E9F0FF', borderColor: '#5279D8' }, filterText: { color: '#7A8B84', fontSize: 10, fontWeight: '800' }, filterTextActive: { color: '#2456C6' },
  matchCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E8F4', borderRadius: 17, padding: 15, gap: 9, shadowColor: '#19315C', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, matchMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, format: { color: '#2456C6', fontSize: 10, fontWeight: '900' }, status: { color: '#75839A', fontSize: 10, fontWeight: '900' }, liveStatus: { color: '#E34B54' }, matchTitle: { color: '#172B4D', fontSize: 17, fontWeight: '900' }, matchSub: { color: '#75839A', fontSize: 11, marginTop: 2 }, score: { color: '#A36C0B', fontSize: 12, fontWeight: '900', backgroundColor: '#FFF8E9', padding: 9, borderRadius: 9 }, buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 }, primaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2456C6', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 11 }, primaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, secondaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F4FC', borderWidth: 1, borderColor: '#DCE4F2', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 11 }, secondaryText: { color: '#284FAD', fontSize: 12, fontWeight: '800' },
  sectionHeader: { backgroundColor: '#FFFFFF', padding: 15, borderRadius: 15, borderWidth: 1, borderColor: '#E1E8F4' }, sectionTitle: { color: '#172B4D', fontSize: 16, fontWeight: '900' }, sectionSub: { color: '#75839A', fontSize: 11, marginTop: 5 }, input: { backgroundColor: '#FFFFFF', borderColor: '#DCE4F2', borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, color: '#172B4D' }, roleFilters: { flexDirection: 'row', gap: 7, marginVertical: 2 }, roleChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#DCE4F2', backgroundColor: '#FFFFFF' }, roleChipActive: { backgroundColor: '#E9F0FF', borderColor: '#5279D8' }, roleChipText: { color: '#75839A', fontSize: 10, fontWeight: '800' }, roleChipTextActive: { color: '#2456C6' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderColor: '#E1E8F4', borderWidth: 1, borderRadius: 14, padding: 11 }, playerPicked: { borderColor: '#5478D1', backgroundColor: '#F0F5FF' }, playerAvatar: { width: 37, height: 37, borderRadius: 13, backgroundColor: '#EAF0FF', alignItems: 'center', justifyContent: 'center' }, playerInitial: { color: '#315BB8', fontWeight: '900' }, playerName: { color: '#172B4D', fontSize: 12, fontWeight: '900' }, playerMeta: { color: '#75839A', fontSize: 9, marginTop: 3 }, captainBtn: { width: 29, height: 29, borderRadius: 9, borderWidth: 1, borderColor: '#D6E1DB', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }, captainSelected: { backgroundColor: '#F5C451', borderColor: '#E8B83D' }, viceSelected: { backgroundColor: '#D9CCFF', borderColor: '#A894E8' }, captainText: { color: '#71809A', fontSize: 10, fontWeight: '900' }, captainTextSelected: { color: '#44320B' }, helper: { color: '#7B8D85', fontSize: 11, lineHeight: 17 }, fullBtn: { marginTop: 4, flex: 0 },
  pointsCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EDF3FF', borderWidth: 1, borderColor: '#D6E2FF', borderRadius: 14, padding: 12 }, pointsTitle: { color: '#2456C6', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }, pointsSub: { color: '#75839A', fontSize: 10, marginTop: 4 }, pointsRefresh: { width: 35, height: 35, borderRadius: 11, backgroundColor: '#2456C6', alignItems: 'center', justifyContent: 'center' },
  leaderboardBtn: { backgroundColor: '#F0F4FC', borderWidth: 1, borderColor: '#DCE4F2', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 }, leaderboardBtnText: { color: '#284FAD', fontSize: 11, fontWeight: '900' }, leaderboardPanel: { width: '100%', marginTop: 8, padding: 11, borderRadius: 11, backgroundColor: '#F7F9FD', borderWidth: 1, borderColor: '#E1E8F4' }, leaderboardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }, leaderboardTitle: { color: '#31466D', fontSize: 10, fontWeight: '900' }, leaderboardState: { color: '#2456C6', fontSize: 9, fontWeight: '900' }, rankRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#E6EBF4' }, rankNumber: { width: 28, color: '#A36C0B', fontSize: 11, fontWeight: '900' }, rankTeam: { flex: 1, color: '#31466D', fontSize: 11, fontWeight: '700' }, rankPoints: { color: '#2456C6', fontSize: 11, fontWeight: '900' },
  contestCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E8F4', borderRadius: 15, padding: 14 }, contestTitle: { color: '#172B4D', fontWeight: '900', fontSize: 14 }, contestSub: { color: '#75839A', fontSize: 10, marginTop: 5 }, joinBtn: { backgroundColor: '#2456C6', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }, joinDisabled: { backgroundColor: '#AAB6CC' }, joinText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 }, empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42, gap: 10 }, emptyTitle: { color: '#31466D', fontSize: 15, fontWeight: '900' }, emptySub: { color: '#75839A', fontSize: 11, textAlign: 'center', lineHeight: 17 }, loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 }, loadingText: { color: '#75839A', fontSize: 11 }, errorBox: { marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 11, backgroundColor: '#FFF0EF', borderWidth: 1, borderColor: '#F8D3D0', flexDirection: 'row', gap: 7, alignItems: 'center' }, errorText: { color: '#B83C3C', fontSize: 11, flex: 1 }, dismiss: { color: '#B83C3C', fontSize: 20, paddingHorizontal: 3 },
});
