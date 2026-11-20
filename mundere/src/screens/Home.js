// Главный экран: Контакты · Чаты · Профиль, стеклянная панель снизу.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Animated, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, loadPeers, cidOf, unread } from '../store';
import { people, M, auth } from '../api';
import { C, Glass, Press, Avatar, GAvatar, Vf, bubble, when, pvNice, seen, gN, tap, toast, ListBg } from '../ui';
import { Image } from 'expo-image';
import { avaUri, authed } from '../api';
import ProfileView from '../ProfileView';

const TABS = [['contacts', 'person-circle', 'Контакты'], ['chats', 'chatbubble', 'Чаты'], ['me', 'planet', 'Профиль']];

export default function Home({ navigation, onLogout }) {
  useStore();
  const ins = useSafeAreaInsets();
  const [tab, setTab] = useState('chats');
  const [tw, setTw] = useState(0);
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
    <View style={{ paddingTop: ins.top + 10, paddingBottom: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
        <Text style={{ flex: 1, color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginLeft: 4 }}>{title}</Text>
        {right}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 8, marginHorizontal: 12, height: 40, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.07)' }}>
        <Ionicons name="search" size={16} color="#9c94bb" />
        <TextInput value={q} onChangeText={setQ} placeholder={tab === 'contacts' ? 'Ник или ID человека' : 'Поиск людей и чатов'} placeholderTextColor="#9c94bb" style={{ flex: 1, color: '#fff', fontSize: 15, marginLeft: 8, paddingVertical: 0 }} selectionColor={C.violet} />
        {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color="#9c94bb" /></Pressable>}
      </View>
    </View>
  );
  const me = S.peers[M.me];
  const pencil = <Press onPress={newMenu} pop round={22} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="pencil-outline" size={21} color="#b9b2d4" /></Press>;

  return (
    <View style={{ flex: 1, backgroundColor: '#0d0819' }}>
      <ListBg />
      {tab === 'chats' && (
        <FlatList
          data={chats}
          keyExtractor={c => c.c}
          ListHeaderComponent={head('Чаты', pencil)}
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
          ListHeaderComponent={<>{head('Контакты', pencil)}
            {!ql && <Press onPress={() => navigation.navigate('Chat', { c: cidOf(M.me), peer: String(M.me) })} scale={0.98} style={{ flexDirection: 'row', alignItems: 'center', padding: 8, marginHorizontal: 6 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#3e88f7', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="document-text-outline" size={24} color="#fff" /></View>
              <View style={{ marginLeft: 11 }}><Text style={{ color: '#fff', fontSize: 15.5, fontWeight: '700' }}>Избранное</Text><Text style={{ color: '#8e8e93', fontSize: 14, marginTop: 2 }}>заметки и файлы для себя</Text></View>
            </Press>}
            {!ql && contacts.length > 0 && <Text style={{ color: '#9c94bb', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4, marginLeft: 16, marginTop: 10, marginBottom: 2 }}>МОИ КОНТАКТЫ</Text>}</>}
          ListFooterComponent={<View style={{ height: 120 }} />}
          ListEmptyComponent={<Empty icon="people-outline" t={ql ? 'Никого не нашли' : 'Контактов пока нет'} s="Ищи по нику или ID" />}
          renderItem={({ item }) => <PeopleRow p={item} onPress={() => openPeer(item.id)} />}
        />
      )}
      {tab === 'me' && <ProfileView id={String(M.me)} own navigation={navigation} top={ins.top + 12} footer={
        <Press pop round={22} amt={0.03} onPress={async () => { try { await auth('logout'); } catch (e) {} onLogout(); }} style={{ marginTop: 12 }}>
          <View style={{ height: 54, borderRadius: 22, backgroundColor: 'rgba(255,91,91,.1)', borderWidth: 1, borderColor: 'rgba(255,91,91,.25)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="log-out-outline" size={20} color={C.red} /><Text style={{ color: C.red, fontSize: 16, fontWeight: '600', marginLeft: 8 }}>Выйти из аккаунта</Text></View>
        </Press>} />}

      {!S.net && <View style={{ position: 'absolute', top: ins.top + 4, alignSelf: 'center' }}><Glass round={14} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: '#ffd27a' }}>Ожидание сети…</Text></Glass></View>}

      <View style={{ position: 'absolute', left: 12, right: 12, bottom: ins.bottom + 12 }}>
        <View style={{ height: 64, borderRadius: 32, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.12)', flexDirection: 'row', padding: 5 }} onLayout={e => setTw((e.nativeEvent.layout.width - 12) / 3)}>
          <Glass round={32} intensity={50} style={StyleSheet.absoluteFill}><View /></Glass>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(14,9,26,.55)' }]} />
          <LinearGradient colors={['rgba(255,255,255,.12)', 'rgba(255,255,255,.03)']} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={StyleSheet.absoluteFill} />
          {tw > 0 && <Animated.View style={{ position: 'absolute', left: 5, top: 5, width: tw, height: 52, borderRadius: 27, overflow: 'hidden', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.4)', transform: [{ translateX: x.interpolate({ inputRange: [0, 2], outputRange: [0, (tw + 1) * 2] }) }, { scaleX: x.interpolate({ inputRange: [0, 0.5, 1, 1.5, 2], outputRange: [1, 1.12, 1, 1.12, 1] }) }] }}>
            <LinearGradient colors={['rgba(255,255,255,.22)', 'rgba(255,255,255,.06)']} start={{ x: 0.3, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
          </Animated.View>}
          {TABS.map(([k, ic, t], i) => (
            <Press key={k} onPress={() => go(k, i)} pop round={27} amt={0.08} style={{ width: tw || 100, height: 52, alignItems: 'center', justifyContent: 'center', marginRight: 1 }}>
              {k === 'me' ? <Image source={authed(avaUri(me ? me.avatar : 'planet'))} style={{ width: 28, height: 28, borderRadius: 14 }} /> : <Ionicons name={ic} size={25} color={tab === k ? C.blue : '#fff'} />}
              <Text style={{ color: tab === k ? C.blue : '#fff', fontSize: 11.5, fontWeight: '600', marginTop: 3 }}>{t}</Text>
              {k === 'chats' && n > 0 && <View style={{ position: 'absolute', top: 3, left: (tw || 100) / 2 + 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text></View>}
            </Press>
          ))}
        </View>
      </View>
    </View>
  );
}

const ChatRow = React.memo(function ChatRow({ c, onPress }) {
  const g = c.g, p = S.peers[c.p], mine = String(c.f) === String(M.me), self = !g && String(c.p) === String(M.me);
  const rd = mine && c.n && (S.read[c.c] ?? c.r ?? -1) >= c.n - 1;
  const who = g && g.type !== 'channel' && c.n > 1 ? (mine ? 'Вы' : (S.peers[c.f] || {}).name) : '';
  return (
    <Press onPress={onPress} scale={0.98} style={{ flexDirection: 'row', alignItems: 'center', padding: 8, marginHorizontal: 6, borderRadius: 16 }}>
      {g ? <GAvatar g={g} size={52} /> : <Avatar p={p} size={52} />}
      <View style={{ flex: 1, marginLeft: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {g && <Ionicons name={g.type === 'channel' ? 'megaphone' : 'people'} size={14} color="#fff" style={{ marginRight: 4, opacity: 0.85 }} />}
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 15.5, fontWeight: '700', flexShrink: 1 }}>{g ? g.title : self ? 'Избранное' : p ? p.name : 'ID ' + c.p}</Text>
          <Vf on={g ? g.vf : p && p.verified} size={15} />
          <View style={{ flex: 1 }} />
          {mine && !(g && g.type === 'channel') && <Ionicons name={rd ? 'checkmark-done' : 'checkmark'} size={15} color={rd ? C.blue : C.mute} style={{ marginRight: 3 }} />}
          <Text style={{ color: C.mute, fontSize: 12 }}>{when(c.t)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: C.mute, fontSize: 14, lineHeight: 18 }}>
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
    <Press onPress={onPress} scale={0.98} style={{ flexDirection: 'row', alignItems: 'center', padding: 8, marginHorizontal: 6 }}>
      <Avatar p={p} size={52} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 15.5, fontWeight: '700' }}>{p.name}</Text><Vf on={p.verified} size={15} /></View>
        <Text style={{ color: p.online ? C.blue : C.mute, fontSize: 14, marginTop: 2 }}>{seen(p)}</Text>
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
        <Row ic="create-outline" t="Изменить профиль" s="имя, аватарка, о себе" onPress={() => navigation.navigate('EditMe')} />
        <Row ic="person-outline" t="Мой профиль" onPress={() => navigation.navigate('Profile', { id: String(M.me) })} />
        <Row ic="bookmark-outline" t="Избранное" s="сообщения себе" onPress={() => navigation.navigate('Chat', { c: cidOf(M.me), peer: String(M.me) })} />
        <Row ic="log-out-outline" t="Выйти из аккаунта" red onPress={async () => { try { await auth('logout'); } catch (e) {} onLogout(); }} />
      </Glass>
      <Text style={{ color: C.mute, fontSize: 13, textAlign: 'center', marginTop: 18, paddingHorizontal: 30 }}>Mundere — тот же аккаунт и те же чаты, что и в Mundora. Сообщения хранятся зашифрованными.</Text>
    </View>
  );
}
