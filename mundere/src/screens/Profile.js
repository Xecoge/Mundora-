// Профиль человека: аватарка, имя, галочка, статус, кнопка «Написать», канал в профиле.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, loadPeers, cidOf } from '../store';
import { M, ms, avaUri } from '../api';
import { C, Glass, GlassBtn, Press, Avatar, GAvatar, Vf, seen, gN, when, pvNice } from '../ui';

export default function Profile({ route, navigation }) {
  useStore();
  const id = String(route.params.id), ins = useSafeAreaInsets();
  const p = S.peers[id], me = id === String(M.me);
  const [ch, setCh] = useState(null);
  const [on, setOn] = useState(null);
  useEffect(() => {
    loadPeers([id], true);
    ms('pch', null, '&u=' + id).then(j => setCh(j.ch)).catch(() => {});
    ms('on', null, '&ids=' + id).then(j => setOn(j.on && j.on[id])).catch(() => {});
  }, [id]);
  const Btn = ({ ic, t, onPress }) => (
    <Press onPress={onPress} pop round={16} amt={0.08} style={{ flex: 1, marginHorizontal: 4 }}>
      <Glass round={16} style={{ height: 64, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={ic} size={23} color="#b9a3ff" /><Text style={{ color: '#b9a3ff', fontSize: 12.5, fontWeight: '600', marginTop: 3 }}>{t}</Text>
      </Glass>
    </Press>
  );
  return (
    <LinearGradient colors={['#1b0d3d', '#0d0819', '#0a0614']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: ins.top + 60, paddingBottom: 60, paddingHorizontal: 16 }}>
        <View style={{ alignItems: 'center' }}>
          <Press pop round={60} amt={0.06} onPress={() => p && navigation.navigate('Viewer', { uri: avaUri(p.avatar), plain: 1 })}><Avatar p={p} size={120} /></Press>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}><Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>{p ? p.name : '…'}</Text><Vf on={p && p.verified} size={22} /></View>
          <Text style={{ color: (on && on.on) ? '#b9a3ff' : C.mute, fontSize: 15, marginTop: 4 }}>{me ? 'это вы' : seen(p, on && on.on)}</Text>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 22, marginHorizontal: -4 }}>
          <Btn ic="chatbubble" t={me ? 'Избранное' : 'Написать'} onPress={() => navigation.navigate('Chat', { c: cidOf(id), peer: id })} />
        </View>
        <Glass round={18} style={{ marginTop: 16, padding: 16 }}>
          <Text style={{ color: C.mute, fontSize: 13 }}>ID</Text>
          <Text style={{ color: '#fff', fontSize: 16, marginTop: 2 }}>{id}</Text>
        </Glass>
        {ch && (
          <>
            <Text style={{ color: C.mute, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 22, marginBottom: 8, marginLeft: 6 }}>Канал</Text>
            <Press pop round={18} amt={0.03} onPress={async () => {
              if (!ch.member) { try { await ms('gjoin', { c: ch.id, inv: ch.inv }); } catch (e) {} }
              navigation.navigate('Chat', { c: ch.id });
            }}>
              <Glass round={18} style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
                <GAvatar g={ch} size={56} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{ch.title}</Text><Vf on={ch.vf} size={15} /></View>
                  <Text style={{ color: C.mute, fontSize: 13 }}>{gN(ch)}{ch.t ? ' · ' + when(ch.t) : ''}</Text>
                  {!!ch.pv && <Text numberOfLines={2} style={{ color: '#ddd', fontSize: 14, marginTop: 3 }}>{pvNice(ch.pv)}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.mute} />
              </Glass>
            </Press>
          </>
        )}
      </ScrollView>
      <View style={{ position: 'absolute', top: ins.top + 4, left: 8 }}><GlassBtn icon="chevron-back" onPress={() => navigation.goBack()} /></View>
    </LinearGradient>
  );
}
