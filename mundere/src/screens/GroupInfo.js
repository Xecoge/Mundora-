// Информация о группе/канале: аватарка, участники, ссылка-приглашение, права, галочка, выход.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, loadPeers, cidOf, emit, toggleMute } from '../store';
import { M, ms, BASE, gAvaUri } from '../api';
import { C, Glass, GlassBtn, Press, Avatar, GAvatar, Vf, gN, seen, bubble, toast, Wallpaper } from '../ui';
import { TopBar } from './Profile';

const SUP = () => ['0', '1'].includes(String(M.me));

export default function GroupInfo({ route, navigation }) {
  useStore();
  const { c } = route.params, ins = useSafeAreaInsets();
  const [info, setInfo] = useState(null);
  const g = (info && info.g) || S.G[c] || {};
  const ch = g.type === 'channel';
  async function load() {
    try { const j = await ms('ginfo', null, '&c=' + c); S.G[c] = j.g; setInfo(j); loadPeers(j.members.map(String)); emit(); } catch (e) { toast(e.message, 1); }
  }
  useEffect(() => { load(); }, [c]);
  const link = g.inv ? BASE + '/#msgj-' + c + '-' + g.inv : '';
  const mem = info ? info.members.map(String).sort((a, b) => (b === String(g.owner)) - (a === String(g.owner)) || info.admins.map(String).includes(b) - info.admins.map(String).includes(a)) : [];
  const adm = info ? info.admins.map(String) : [];

  const leave = e => bubble({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, [{ t: ch ? 'Отписаться от канала' : 'Покинуть группу', ic: 'exit-outline', red: 1, fn: async () => {
    try { await ms('gleave', { c }); S.chats = S.chats.filter(x => x.c !== c); delete S.msgs[c]; emit(); navigation.popToTop(); toast(ch ? 'Ты отписался' : 'Ты вышел из группы'); } catch (er) { toast(er.message, 1); }
  } }]);
  const invite = e => bubble({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, [
    { t: 'Скопировать ссылку', ic: 'copy-outline', fn: () => { Clipboard.setStringAsync(link); toast('Ссылка скопирована'); } },
    { t: 'Поделиться', ic: 'share-outline', fn: () => Share.share({ message: (ch ? 'Подписывайся на канал «' : 'Вступай в группу «') + g.title + '» в Mundere: ' + link }) },
  ]);
  const memMenu = (u, e) => {
    if (u === String(M.me)) return navigation.navigate('Profile', { id: u });
    const isA = adm.includes(u), sup = ['0', '1'].includes(u);
    bubble({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, [
      { t: 'Написать', ic: 'chatbubble-outline', fn: () => navigation.navigate('Chat', { c: cidOf(u), peer: u }) },
      { t: 'Профиль', ic: 'person-outline', fn: () => navigation.navigate('Profile', { id: u }) },
      ...(g.own && u !== String(g.owner) ? [{ t: isA ? 'Снять администратора' : 'Сделать администратором', ic: 'star-outline', fn: async () => { try { await ms('gadmin', { c, u, on: isA ? 0 : 1 }); toast(isA ? 'Больше не администратор' : 'Назначен администратором'); load(); } catch (er) { toast(er.message, 1); } } }] : []),
      ...(g.own && u !== String(g.owner) && !sup ? ['-', { t: ch ? 'Удалить из канала' : 'Удалить из группы', ic: 'trash-outline', red: 1, fn: async () => { try { await ms('gkick', { c, u }); toast('Удалён'); load(); } catch (er) { toast(er.message, 1); } } }] : []),
    ]);
  };
  const Act = ({ ic, t, onPress, red }) => (
    <Press onPress={onPress} pop round={16} amt={0.08} style={{ flex: 1, marginHorizontal: 4 }}>
      <Glass round={16} style={{ height: 64, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={ic} size={23} color={red ? C.red : C.blue} /><Text style={{ color: red ? C.red : C.blue, fontSize: 12.5, fontWeight: '600', marginTop: 3 }}>{t}</Text>
      </Glass>
    </Press>
  );
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Wallpaper />
      <ScrollView contentContainerStyle={{ paddingTop: ins.top + 76, paddingBottom: 60, paddingHorizontal: 16 }}>
        <View style={{ alignItems: 'center' }}>
          <Press pop round={55} amt={0.06} onPress={() => g.av && navigation.navigate('Viewer', { uri: gAvaUri(g), plain: 1 })}><GAvatar g={g} size={110} /></Press>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}><Text style={{ color: '#fff', fontSize: 25, fontWeight: '800' }}>{g.title}</Text><Vf on={g.vf} size={21} /></View>
          <Text style={{ color: C.mute, fontSize: 15, marginTop: 4 }}>{gN(g, info ? info.members.length : g.n)}</Text>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 20, marginHorizontal: -4 }}>
          <Act ic="chatbubble-ellipses-outline" t="Чат" onPress={() => navigation.goBack()} />
          <Act ic={S.muted && S.muted[c] ? 'volume-high-outline' : 'notifications-outline'} t={S.muted && S.muted[c] ? 'Вкл. звук' : 'Без звука'} onPress={() => toast(toggleMute(c) ? 'Уведомления выключены' : 'Уведомления включены')} />
          {!!link && <Act ic="share-outline" t="Пригласить" onPress={invite} />}
          <Act ic="exit-outline" t="Выйти" red onPress={leave} />
        </View>
        {!!g.about && <Glass round={18} style={{ marginTop: 16, padding: 14 }}><Text style={{ color: C.mute, fontSize: 13 }}>описание</Text><Text style={{ color: '#fff', fontSize: 16, marginTop: 2 }}>{g.about}</Text></Glass>}
        {!!link && <Press onPress={invite} pop round={18} amt={0.03}><Glass round={18} style={{ marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}><Ionicons name="link" size={22} color={C.blue} /><View style={{ flex: 1, marginLeft: 12 }}><Text style={{ color: C.mute, fontSize: 13 }}>ссылка-приглашение</Text><Text style={{ color: C.blue, fontSize: 15, marginTop: 2 }} numberOfLines={2}>{link.replace(/^https?:\/\//, '')}</Text></View></Glass></Press>}
        {SUP() && (
          <Glass round={18} style={{ marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={22} color={C.blue} />
            <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ color: '#fff', fontSize: 16 }}>Галочка {ch ? 'канала' : 'группы'}</Text><Text style={{ color: C.mute, fontSize: 13 }}>подтверждённый, видна всем</Text></View>
            <Switch value={!!g.vf} onValueChange={async v => { try { const j = await ms('gverify', { c, on: v ? 1 : 0 }); S.G[c] = j.g; emit(); load(); } catch (e) { toast(e.message, 1); } }} />
          </Glass>
        )}
        <Text style={{ color: C.mute, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 22, marginBottom: 8, marginLeft: 6 }}>{gN(g, mem.length || g.n)}</Text>
        <Glass round={18}>
          {(!ch || g.admin) && (
            <Press pop round={14} amt={0.03} onPress={() => navigation.navigate('NewGroup', { type: g.type, add: c, have: mem })} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 54 }}>
              <Ionicons name="person-add-outline" size={22} color={C.blue} /><Text style={{ color: C.blue, fontSize: 16, marginLeft: 14 }}>{ch ? 'Добавить подписчиков' : 'Добавить участников'}</Text>
            </Press>
          )}
          {mem.map(u => {
            const p = S.peers[u], role = u === String(g.owner) ? 'владелец' : adm.includes(u) ? 'админ' : '';
            return (
              <Press key={u} scale={0.98} onPress={e => memMenu(u, e)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 }}>
                <Avatar p={p} size={42} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{u === String(M.me) ? 'Вы' : p ? p.name : 'ID ' + u}</Text><Vf on={p && p.verified} size={14} /></View>
                  <Text style={{ color: C.mute, fontSize: 13 }}>{seen(p)}</Text>
                </View>
                {!!role && <Text style={{ color: C.mute, fontSize: 13 }}>{role}</Text>}
              </Press>
            );
          })}
        </Glass>
      </ScrollView>
      <TopBar title={ch ? 'Канал' : 'Группа'} onBack={() => navigation.goBack()} right={g.admin ? 'pencil' : null} onRight={() => navigation.navigate('NewGroup', { type: g.type, edit: c })} />
    </View>
  );
}
