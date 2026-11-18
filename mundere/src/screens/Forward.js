// Переслать сообщение в другой чат (группы — если можно писать, каналы — если ты админ).
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, poke } from '../store';
import { M, ms } from '../api';
import { C, Glass, GlassBtn, Press, Avatar, GAvatar, Vf, gN, toast } from '../ui';

export default function Forward({ route, navigation }) {
  useStore();
  const { c, i } = route.params, ins = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const ql = q.trim().toLowerCase();
  const L = S.chats.filter(x => (x.g ? x.g.type !== 'channel' || x.g.admin : true))
    .filter(x => !ql || (x.g ? x.g.title.toLowerCase().includes(ql) : ((S.peers[x.p] || {}).name || '').toLowerCase().includes(ql)));
  async function go(x) {
    if (busy) return; setBusy(true);
    try { await ms('fwd', { c, i, to: x.g ? x.c : String(x.p) }); toast('Переслано'); poke(); navigation.goBack(); }
    catch (e) { toast(e.message, 1); setBusy(false); }
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#111114', paddingTop: ins.top ? 8 : 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, marginBottom: 8 }}>
        <GlassBtn icon="close" onPress={() => navigation.goBack()} />
        <Text style={{ flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginRight: 44 }}>Переслать</Text>
      </View>
      <Glass round={14} style={{ marginHorizontal: 12, height: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }}>
        <Ionicons name="search" size={17} color={C.mute} />
        <TextInput value={q} onChangeText={setQ} placeholder="Кому переслать" placeholderTextColor={C.mute} style={{ flex: 1, color: '#fff', fontSize: 16, marginLeft: 8, paddingVertical: 0 }} />
      </Glass>
      <FlatList data={L} keyExtractor={x => x.c} contentContainerStyle={{ paddingVertical: 8, paddingBottom: ins.bottom + 20 }}
        renderItem={({ item: x }) => {
          const p = S.peers[x.p], self = !x.g && String(x.p) === String(M.me);
          return (
            <Press onPress={() => go(x)} pop round={14} amt={0.03} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 }}>
              {x.g ? <GAvatar g={x.g} size={46} /> : <Avatar p={p} size={46} />}
              <View style={{ marginLeft: 12, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{x.g ? x.g.title : self ? 'Избранное' : p ? p.name : 'ID ' + x.p}</Text><Vf on={x.g ? x.g.vf : p && p.verified} size={14} /></View>
                {x.g && <Text style={{ color: C.mute, fontSize: 13 }}>{gN(x.g)}</Text>}
              </View>
              <Ionicons name="arrow-redo" size={18} color={C.blue} />
            </Press>
          );
        }} />
    </View>
  );
}
