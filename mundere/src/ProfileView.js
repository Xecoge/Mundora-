// Профиль как на сайте Mundora: шапка-карточка с подарками и аватаркой, кнопки, «о себе / почта / в Mundora»,
// подарки, капитализация (уровень, рейтинг, заработано/потрачено).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, loadPeers, cidOf } from './store';
import { M, ms, people, BASE, avaUri, authed } from './api';
import { C, Glass, Press, Vf, GAvatar, seen, gN, when, pvNice, toast, ListBg } from './ui';

const GIFT_N = { usdt: 'Стопка USDT', btc: 'Золотой биткоин', doge: 'Doge-монета', eth: 'Эфир-кристалл', ton: 'Алмаз TON', ledger: 'Холодный кошелёк', rocket: 'Ракета to the Moon', bull: 'Бык', bear: 'Медведь', miner: 'Майнинг-риг', whale: 'Кит', diamond: 'Diamond Hands' };
const giftImg = k => BASE + (GIFT_N[k] ? '/img/gifts/' + k + '.webp' : '/img/gift_planet.webp');
const PAT = [[4, 8, -12], [16, 30, 8], [6, 58, 14], [18, 84, -6], [30, 6, 4], [30, 62, -10], [70, 8, 10], [84, 28, -8], [94, 56, 6], [80, 84, 12], [68, 62, -4], [44, 90, 8], [56, 4, -6], [92, 6, -14], [2, 86, 4], [96, 86, -10]];
const fmt = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default function ProfileView({ id, navigation, own, footer, top }) {
  const ins = useSafeAreaInsets();
  const [p, setP] = useState(null);
  const [ch, setCh] = useState(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    let off = false;
    people('id=' + id).then(j => { if (!off) setP(j.profile || null); }).catch(() => {});
    ms('pch', null, '&u=' + id).then(j => { if (!off) setCh(j.ch); }).catch(() => {});
    loadPeers([id], true);
    return () => { off = true; };
  }, [id]);
  const q = p || S.peers[id] || {};
  const gifts = (p && p.gifts) || [], gby = Object.fromEntries(gifts.map(g => [g.id, g]));
  const pos = ((p && p.pos) || []).filter(x => gby[x.id]);
  const patK = ((pos[0] && gby[pos[0].id]) || gifts[0] || {}).k;
  const cap = p && p.capital;
  const joined = p && p.joined ? new Date(p.joined).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '') : '';
  const Act = ({ ic, t, onPress }) => (
    <Press onPress={onPress} pop round={16} amt={0.08} style={{ flex: 1 }}>
      <View style={st.act}><Ionicons name={ic} size={21} color="#fff" /><Text style={st.actT} numberOfLines={1}>{t}</Text></View>
    </Press>
  );
  const pct = cap ? (cap.to == null ? 100 : Math.max(3, Math.min(100, Math.round((cap.score - cap.from) / (cap.to - cap.from) * 100)))) : 0;

  return (
    <View style={{ flex: 1 }}>
      <ListBg />
      <ScrollView contentContainerStyle={{ paddingTop: (top ?? ins.top + 72), paddingHorizontal: 12, paddingBottom: ins.bottom + 110 }}>
        {/* шапка-карточка */}
        <View style={st.hero} onLayout={e => setW(e.nativeEvent.layout.width)}>
          <LinearGradient colors={['rgba(124,58,237,.42)', 'rgba(40,18,82,.55)', 'rgba(14,10,24,.9)']} locations={[0, 0.55, 1]} start={{ x: 0.5, y: 0.15 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
          {!!patK && W > 0 && PAT.map(([x, y, r], k) => <Image key={k} source={{ uri: giftImg(patK) }} style={{ position: 'absolute', left: (x / 100) * W - 15, top: (y / 100) * 290 - 15, width: 30, height: 30, opacity: 0.09, transform: [{ rotate: r + 'deg' }] }} contentFit="contain" />)}
          <View style={{ height: 200, width: '100%' }}>
            {W > 0 && pos.map(x => <Image key={x.id} source={{ uri: giftImg(gby[x.id].k) }} style={{ position: 'absolute', left: (x.x / 100) * (W - 20) - 26, top: (x.y / 100) * 200 - 26, width: 52, height: 52 }} contentFit="contain" />)}
            <View style={st.avaWrap}><Image source={authed(avaUri(q.avatar))} style={{ width: 112, height: 112, borderRadius: 56 }} contentFit="cover" /></View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
            <Text style={st.name}>{q.name || '…'}</Text><Vf on={q.verified} size={22} />
          </View>
          {!!(p && p.wallets && p.wallets.length) && (
            <View style={{ alignItems: 'center', marginTop: 6 }}>
              <View style={st.wal}><Ionicons name="wallet" size={15} color="#fff" /><Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '700', marginLeft: 6 }}>{p.wallets.length === 1 ? p.wallets[0].name : p.wallets.length + ' ' + (p.wallets.length < 5 ? 'кошелька' : 'кошельков')}</Text></View>
            </View>
          )}
          <Text style={st.seen}>{own ? 'в сети' : seen(q)}</Text>
        </View>

        {/* кнопки */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {own ? <Act ic="pencil-outline" t="Изменить" onPress={() => navigation.navigate('EditMe')} /> : <Act ic="chatbubble-ellipses-outline" t="Написать" onPress={() => navigation.navigate('Chat', { c: cidOf(id), peer: String(id) })} />}
          {own && <Act ic="bookmark-outline" t="Избранное" onPress={() => navigation.navigate('Chat', { c: cidOf(M.me), peer: String(M.me) })} />}
          <Act ic="copy-outline" t={'ID ' + id} onPress={() => { Clipboard.setStringAsync(String(id)); toast('ID скопирован'); }} />
          <Act ic="globe-outline" t="Mundora" onPress={() => Linking.openURL(BASE + '/#u-' + id)} />
        </View>

        {/* о себе · почта · в Mundora */}
        {!!p && (p.bio || p.email || joined) && (
          <View style={[st.card, { paddingVertical: 4 }]}>
            {[p.bio ? ['о себе', p.bio, 0] : null, p.email ? ['почта', p.email, 1] : null, joined ? ['в Mundora', 'с ' + joined, 0] : null].filter(Boolean).map(([l, v, lock], k) => (
              <View key={l} style={[{ paddingVertical: 11 }, k && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.07)' }]}>
                <Text style={st.lbl}>{l}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>{lock ? <Ionicons name="lock-closed-outline" size={14} color="#fff" style={{ marginRight: 6 }} /> : null}<Text style={st.val}>{v}</Text></View>
              </View>
            ))}
          </View>
        )}

        {/* канал в профиле */}
        {ch && (
          <Press pop round={22} amt={0.03} onPress={async () => { if (!ch.member) { try { await ms('gjoin', { c: ch.id, inv: ch.inv }); } catch (e) {} } navigation.navigate('Chat', { c: ch.id }); }}>
            <View style={[st.card, { flexDirection: 'row', alignItems: 'center' }]}>
              <GAvatar g={ch} size={52} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={st.lbl}>канал</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{ch.title}</Text><Vf on={ch.vf} size={15} /></View>
                <Text style={{ color: C.sub, fontSize: 13 }}>{gN(ch)}{ch.t ? ' · ' + when(ch.t) : ''}</Text>
                {!!ch.pv && <Text numberOfLines={2} style={{ color: '#ddd', fontSize: 14, marginTop: 2 }}>{pvNice(ch.pv)}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.sub} />
            </View>
          </Press>
        )}

        {/* подарки */}
        {!!p && (
          <View style={[st.card, { paddingVertical: 14 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>Подарки</Text>
              {gifts.length > 0 && <Text style={{ color: C.sub, fontSize: 13, marginLeft: 8 }}>{gifts.length}</Text>}
            </View>
            {gifts.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                {gifts.slice(0, 12).map(g => (
                  <View key={g.id} style={{ width: '33.33%', padding: 4 }}>
                    <View style={st.gift}><Image source={{ uri: giftImg(g.k) }} style={{ width: 58, height: 58 }} contentFit="contain" /><Text numberOfLines={1} style={{ color: '#fff', fontSize: 11.5, fontWeight: '600', marginTop: 4 }}>{GIFT_N[g.k] || 'Подарок'}</Text></View>
                  </View>
                ))}
              </View>
            ) : <Text style={{ color: C.sub, fontSize: 14 }}>Пока нет подарков{own ? '' : ' — подари первым на сайте Mundora'}.</Text>}
          </View>
        )}

        {/* капитализация */}
        {!!cap && (
          <View style={[st.card, { borderRadius: 26, padding: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <LinearGradient colors={['#8b5cf6', '#6d28d9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.lvl}>
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', lineHeight: 28 }}>{cap.level}</Text><Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>ур.</Text>
              </LinearGradient>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: C.sub, fontSize: 12.5 }}>Капитализация · рейтинг</Text>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{cap.title}</Text>
                <Text style={{ color: C.lav, fontSize: 13.5 }}>{cap.to == null ? 'Максимальный уровень' : 'до ' + (cap.level + 1) + ' ур. — ' + fmt(cap.to - cap.score) + ' очков'}</Text>
              </View>
            </View>
            <View style={st.bar}><LinearGradient colors={['#8b5cf6', '#a78bfa']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: pct + '%', height: '100%', borderRadius: 99 }} /></View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -5 }}>
              {[['Заработано', '+' + fmt(cap.earned), C.green], ['Потрачено', fmt(cap.spent), C.red], ['Рейтинг', fmt(cap.score), '#fff'], ['Дней', fmt(cap.stats && cap.stats.days), '#fff']].map(([l, v, c]) => (
                <View key={l} style={{ width: '50%', padding: 5 }}><View style={st.stat}><Text style={{ color: C.sub, fontSize: 12.5 }}>{l}</Text><Text style={{ color: c, fontSize: 22, fontWeight: '800', marginTop: 2 }}>{v}</Text></View></View>
              ))}
            </View>
          </View>
        )}
        {footer}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, overflow: 'hidden', paddingVertical: 18, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', alignItems: 'center' },
  avaWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -60, marginTop: -60, width: 120, height: 120, borderRadius: 60, padding: 4, backgroundColor: 'rgba(255,255,255,.08)', shadowColor: '#7c3aed', shadowOpacity: 0.8, shadowRadius: 25, shadowOffset: { width: 0, height: 14 }, elevation: 14 },
  name: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  wal: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', backgroundColor: 'rgba(18,10,36,.45)' },
  seen: { color: '#b9b0d6', fontSize: 14, marginTop: 6, textAlign: 'center' },
  act: { height: 62, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,.07)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  actT: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 5 },
  card: { marginTop: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,.1)', paddingHorizontal: 16, paddingVertical: 13 },
  lbl: { color: '#9c94bb', fontSize: 12.5, marginBottom: 2 },
  val: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  gift: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  lvl: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 10, borderRadius: 99, backgroundColor: 'rgba(255,255,255,.07)', marginTop: 14, overflow: 'hidden' },
  stat: { padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' },
});
