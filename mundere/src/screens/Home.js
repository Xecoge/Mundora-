// Главный экран: Контакты · Чаты · Профиль, стеклянная панель снизу.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Animated, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, loadPeers, cidOf, unread } from '../store';
import { people, M, auth } from '../api';
import { C, Glass, Press, Avatar, GAvatar, Vf, bubble, when, pvNice, seen, gN, tap, toast } from '../ui';

const TABS = [['contacts', 'person-circle', 'Контакты'], ['chats', 'chatbubble', 'Чаты'], ['me', 'planet', 'Профиль']];

export default function Home({ navigation, onLogout }) {
  useStore();
  const ins = useSafeAreaInsets();
  const [tab, setTab] = useState('chats');
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const x = useRef(new Animated.Value(1)).current;
  const go = (t, i) => { tap(); setTab(t); Animated.spring(x, { toValue: i, useNativeDriver: true, speed: 14, bounciness: 10 }).start(); };

  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const tm = setTimeout(async () => { try { const j = await people('q=' + encodeURIComponent(q.trim())); setFound(j.people || []); for (const p of j.people || []) S.peers[p.id] = S.peers[p.id] || p; } catch (e) {} }, 280);
    return () => clearTimeout(tm);
  }, [q]);

  const openPeer = id => navigation.navigate('Chat', { c: cidOf(id), peer: String(id) });
  const openChat = c => navigation.navigate('Chat', c.g ? { c: c.c } : { c: c.c, peer: String(c.p) });

  const newMenu = e => bubble({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, [
    { t: 'Новая группа', ic: 'people-outline', fn: () => navigation.navigate('NewGroup', { type: 'group' }) },
    { t: 'Новый канал', ic: 'megaphone-outline', fn: () => navigation.navigate('NewGroup', { type: 'channel' }) },
  ]);

  const ql = q.trim().toLowerCase();
  const chats = S.chats.filter(c => !ql || (c.g ? c.g.title.toLowerCase().includes(ql) : (S.peers[c.p] && S.peers[c.p].name.toLowerCase().includes(ql)) || String(c.p) === ql));
  const contacts = useMemo(() => [...new Set(S.chats.filter(c => c.p != null).map(c => String(c.p)))].map(id => S.peers[id]).filter(Boolean), [S.chats, S.peers, Object.keys(S.peers).length]);
  const W = 108, n = unread();

  const head = (title, right) => (
    <View style={{ paddingTop: ins.top + 6, paddingHorizontal: 16, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 48 }}>
        <Text style={{ flex: 1, color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }}>{title}</Text>
        {right}
      </View>
      {tab !== 'me' && (
        <Glass round={14} style={{ height: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginTop: 6 }}>
          <Ionicons name="search" size={17} color={C.mute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Поиск людей и чатов" placeholderTextColor={C.mute} style={{ flex: 1, color: '#fff', fontSize: 16, marginLeft: 8, paddingVertical: 0 }} selectionColor={C.violet} />
          {!!q && <Pressable onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={C.mute} /></Pressable>}
        </Glass>
      )}
    </View>
  );

  return (
    <LinearGradient colors={['#1b0d3d', '#0d0819', '#0a0614']} locations={[0, 0.45, 1]} style={{ flex: 1 }}>
      {tab === 'chats' && (
        <FlatList
          data={chats}
          keyExtractor={c => c.c}
          ListHeaderComponent={head('Чаты', <Press onPress={newMenu} pop round={22}><Glass round={22} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="create-outline" size={22} color="#fff" /></Glass></Press>)}
          ListFooterComponent={<>{ql && found.length ? <PeopleList list={found} onOpen={openPeer} title="Люди" /> : null}<View style={{ height: 120 }} /></>}
          ListEmptyComponent={!ql ? <Empty icon="chatbubbles-outline" t="Пока нет чатов" s="Найди человека по нику или ID и напиши ему" /> : null}
          renderItem={({ item }) => <ChatRow c={item} onPress={() => openChat(item)} />}
          initialNumToRender={14}
          windowSize={9}
          removeClippedSubviews
        />
      )}
      {tab === 'contacts' && (
        <FlatList
          data={ql ? found : contacts}
          keyExtractor={p => String(p.id)}
          ListHeaderComponent={head('Контакты')}
          ListFooterComponent={<View style={{ height: 120 }} />}
          ListEmptyComponent={<Empty icon="people-outline" t={ql ? 'Никого не нашли' : 'Контактов пока нет'} s="Ищи по нику или ID" />}
          renderItem={({ item }) => <PeopleRow p={item} onPress={() => openPeer(item.id)} />}
        />
      )}
      {tab === 'me' && <MeTab head={head} navigation={navigation} onLogout={onLogout} />}

      {!S.net && <View style={{ position: 'absolute', top: ins.top + 4, alignSelf: 'center' }}><Glass round={14} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: '#ffd27a' }}>Ожидание сети…</Text></Glass></View>}

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: ins.bottom + 10, alignItems: 'center' }}>
        <Glass round={32} intensity={50} style={{ width: W * 3 + 12, height: 64, flexDirection: 'row', padding: 6 }}>
          <Animated.View style={{ position: 'absolute', left: 6, top: 6, width: W, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,.12)', transform: [{ translateX: x.interpolate({ inputRange: [0, 2], outputRange: [0, W * 2] }) }] }} />
          {TABS.map(([k, ic, t], i) => (
            <Press key={k} onPress={() => go(k, i)} pop round={26} amt={0.1} style={{ width: W, height: 52, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={ic} size={24} color={tab === k ? '#b9a3ff' : '#fff'} />
              <Text style={{ color: tab === k ? '#b9a3ff' : '#fff', fontSize: 11, fontWeight: '600', marginTop: 1 }}>{t}</Text>
              {k === 'chats' && n > 0 && <View style={{ position: 'absolute', top: 2, left: W / 2 + 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text></View>}
            </Press>
          ))}
        </Glass>
      </View>
    </LinearGradient>
  );
}

const ChatRow = React.memo(function ChatRow({ c, onPress }) {
  const g = c.g, p = S.peers[c.p], mine = String(c.f) === String(M.me), self = !g && String(c.p) === String(M.me);
  const rd = mine && c.n && (S.read[c.c] ?? c.r ?? -1) >= c.n - 1;
  const who = g && g.type !== 'channel' && c.n > 1 ? (mine ? 'Вы' : (S.peers[c.f] || {}).name) : '';
  return (
    <Press onPress={onPress} scale={0.97} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 }}>
      {g ? <GAvatar g={g} size={56} /> : <Avatar p={p} size={56} />}
      <View style={{ flex: 1, marginLeft: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, paddingBottom: 10, paddingTop: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {g && <Ionicons name={g.type === 'channel' ? 'megaphone' : 'people'} size={14} color="#fff" style={{ marginRight: 4, opacity: 0.85 }} />}
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 16.5, fontWeight: '700', flexShrink: 1 }}>{g ? g.title : self ? 'Избранное' : p ? p.name : 'ID ' + c.p}</Text>
          <Vf on={g ? g.vf : p && p.verified} size={15} />
          <View style={{ flex: 1 }} />
          {mine && !(g && g.type === 'channel') && <Ionicons name={rd ? 'checkmark-done' : 'checkmark'} size={16} color={rd ? '#b9a3ff' : C.mute} style={{ marginRight: 4 }} />}
          <Text style={{ color: C.mute, fontSize: 13 }}>{when(c.t)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text numberOfLines={2} style={{ flex: 1, color: C.mute, fontSize: 15, lineHeight: 19 }}>
            {who ? <Text style={{ color: '#fff' }}>{who}: </Text> : null}{pvNice(c.pv)}
          </Text>
          {c.u > 0 && <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{c.u}</Text></View>}
        </View>
      </View>
    </Press>
  );
});

function PeopleRow({ p, onPress }) {
  return (
    <Press onPress={onPress} scale={0.97} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 }}>
      <Avatar p={p} size={48} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16.5, fontWeight: '600' }}>{p.name}</Text><Vf on={p.verified} size={15} /></View>
        <Text style={{ color: p.online ? '#b9a3ff' : C.mute, fontSize: 14, marginTop: 2 }}>{seen(p)} · ID {p.id}</Text>
      </View>
    </Press>
  );
}
function PeopleList({ list, onOpen, title }) {
  return <View><Text style={{ color: C.mute, fontSize: 13, fontWeight: '600', marginLeft: 16, marginTop: 14, marginBottom: 4, textTransform: 'uppercase' }}>{title}</Text>{list.map(p => <PeopleRow key={p.id} p={p} onPress={() => onOpen(p.id)} />)}</View>;
}
function Empty({ icon, t, s }) {
  return (
    <View style={{ alignItems: 'center', marginTop: 80, paddingHorizontal: 40 }}>
      <Ionicons name={icon} size={56} color="#5b4d84" />
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 14 }}>{t}</Text>
      <Text style={{ color: C.mute, fontSize: 15, textAlign: 'center', marginTop: 6 }}>{s}</Text>
    </View>
  );
}

function MeTab({ head, navigation, onLogout }) {
  useStore();
  useEffect(() => { loadPeers([String(M.me)], true); }, []);
  const p = S.peers[M.me];
  const Row = ({ ic, t, s, onPress, red }) => (
    <Press onPress={onPress} pop round={14} amt={0.03} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 54 }}>
      <Ionicons name={ic} size={22} color={red ? C.red : '#b9a3ff'} />
      <View style={{ flex: 1, marginLeft: 14 }}><Text style={{ color: red ? C.red : '#fff', fontSize: 16 }}>{t}</Text>{s ? <Text style={{ color: C.mute, fontSize: 13 }}>{s}</Text> : null}</View>
      {!red && <Ionicons name="chevron-forward" size={18} color={C.mute} />}
    </Press>
  );
  return (
    <View style={{ flex: 1 }}>
      {head('Профиль')}
      <View style={{ alignItems: 'center', marginTop: 10 }}>
        <Avatar p={p} size={110} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}><Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>{p ? p.name : '…'}</Text><Vf on={p && p.verified} size={22} /></View>
        <Text style={{ color: C.mute, fontSize: 15, marginTop: 4 }}>ID {M.me}</Text>
      </View>
      <Glass round={20} style={{ marginHorizontal: 16, marginTop: 26 }}>
        <Row ic="person-outline" t="Мой профиль" onPress={() => navigation.navigate('Profile', { id: String(M.me) })} />
        <Row ic="bookmark-outline" t="Избранное" s="сообщения себе" onPress={() => navigation.navigate('Chat', { c: cidOf(M.me), peer: String(M.me) })} />
        <Row ic="log-out-outline" t="Выйти из аккаунта" red onPress={async () => { try { await auth('logout'); } catch (e) {} onLogout(); }} />
      </Glass>
      <Text style={{ color: C.mute, fontSize: 13, textAlign: 'center', marginTop: 18, paddingHorizontal: 30 }}>Mundere — тот же аккаунт и те же чаты, что и в Mundora. Сообщения хранятся зашифрованными.</Text>
    </View>
  );
}
