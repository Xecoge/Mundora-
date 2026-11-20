// Профиль один в один с сайтом Mundora:
// шапка с подарками (анимации «пузыри» и «орбита» — физика как на сайте: пузыри летают вокруг аватарки,
// сталкиваются, их можно схватить и бросить), кнопки, инфо, подарки (магазин, просмотр, «у ника»),
// капитализация с кольцом уровня, ценность подарков, уровни и откуда опыт, статистика.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, Animated, PanResponder, Modal, Pressable, Dimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Svg, { Circle, Defs, RadialGradient, Stop, Ellipse } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, loadPeers, cidOf } from './store';
import { M, ms, people, req, BASE, avaUri, authed } from './api';
import { C, Press, Vf, GAvatar, seen, gN, when, pvNice, toast, ListBg, Glass, tap } from './ui';

export const GIFT_CAT = { usdt: { n: 'Стопка USDT', p: 250 }, btc: { n: 'Золотой биткоин', p: 300 }, doge: { n: 'Doge-монета', p: 350 }, eth: { n: 'Эфир-кристалл', p: 400 }, ton: { n: 'Алмаз TON', p: 450 }, ledger: { n: 'Холодный кошелёк', p: 600 }, rocket: { n: 'Ракета to the Moon', p: 800 }, bull: { n: 'Бык', p: 1200 }, bear: { n: 'Медведь', p: 1200 }, miner: { n: 'Майнинг-риг', p: 1500 }, whale: { n: 'Кит', p: 2500 }, diamond: { n: 'Diamond Hands', p: 5000 } };
export const giftImg = k => BASE + (GIFT_CAT[k] ? '/img/gifts/' + k + '.webp' : '/img/gift_planet.webp');
export const giftRar = k => { const p = (GIFT_CAT[k] || {}).p || 0; return p >= 3000 ? { c: 'leg', n: 'Легендарный', gl: 'rgba(255,200,80,.7)' } : p >= 1000 ? { c: 'epic', n: 'Эпический', gl: 'rgba(192,132,252,.6)' } : p >= 450 ? { c: 'rare', n: 'Редкий', gl: 'rgba(96,165,250,.55)' } : { c: 'com', n: 'Обычный', gl: 'rgba(255,255,255,.14)' }; };
const PAT = [[4, 8, -12], [16, 30, 8], [6, 58, 14], [18, 84, -6], [30, 6, 4], [30, 62, -10], [70, 8, 10], [84, 28, -8], [94, 56, 6], [80, 84, 12], [68, 62, -4], [44, 90, 8], [56, 4, -6], [92, 6, -14], [2, 86, 4], [96, 86, -10]];
const fmt = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const kXP = n => (n >= 1000 ? (n / 1000).toString().replace('.', ',') + 'к' : String(n));
const hsh = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const STAGE_H = 200;

export default function ProfileView({ id, navigation, own, footer, top }) {
  const ins = useSafeAreaInsets();
  const [p, setP] = useState(null);
  const [ch, setCh] = useState(null);
  const [W, setW] = useState(0);
  const [sheet, setSheet] = useState(null); // {t:'shop'|'pick'|'view', ...}
  const [meAdmin, setMeAdmin] = useState(false);
  const [more, setMore] = useState(false);
  const load = () => people('id=' + id).then(j => setP(j.profile || null)).catch(() => {});
  useEffect(() => {
    load();
    ms('pch', null, '&u=' + id).then(j => setCh(j.ch)).catch(() => {});
    if (!own) people('id=' + M.me).then(j => setMeAdmin(!!(j.profile && j.profile.admin))).catch(() => {});
    loadPeers([id], true);
  }, [id]);
  const q = p || S.peers[id] || {};
  const gifts = (p && p.gifts) || [], gby = Object.fromEntries(gifts.map(g => [g.id, g]));
  const pos = ((p && p.pos) || []).filter(x => gby[x.id]);
  const patK = ((pos[0] && gby[pos[0].id]) || gifts[0] || {}).k;
  const nickG = p && p.nick && gby[p.nick];
  const cap = p && p.capital;
  const joined = p && p.joined ? new Date(p.joined).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '') : '';
  const pct = cap ? (cap.to == null ? 100 : Math.max(3, Math.min(100, Math.round((cap.score - cap.from) / (cap.to - cap.from) * 100)))) : 0;
  const anim = (p && p.anim) || 'none';

  const Act = ({ ic, t, onPress }) => (
    <Press onPress={onPress} pop round={16} amt={0.08} style={{ flex: 1 }}>
      <View style={st.act}><Ionicons name={ic} size={21} color="#fff" /><Text style={st.actT} numberOfLines={1}>{t}</Text></View>
    </Press>
  );
  const openGift = g => setSheet({ t: 'view', g });

  return (
    <View style={{ flex: 1 }}>
      <ListBg />
      <ScrollView contentContainerStyle={{ paddingTop: (top ?? ins.top + 72), paddingHorizontal: 12, paddingBottom: ins.bottom + 110 }}>
        {/* шапка */}
        <View style={st.hero} onLayout={e => setW(e.nativeEvent.layout.width)}>
          <LinearGradient colors={['rgba(124,58,237,.42)', 'rgba(40,18,82,.55)', 'rgba(14,10,24,.9)']} locations={[0, 0.55, 1]} start={{ x: 0.5, y: 0.15 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
          {!!patK && W > 0 && PAT.map(([x, y, r], k) => <Image key={k} source={{ uri: giftImg(patK) }} style={{ position: 'absolute', left: (x / 100) * W - 15, top: (y / 100) * 300 - 15, width: 30, height: 30, opacity: 0.09, transform: [{ rotate: r + 'deg' }] }} contentFit="contain" />)}
          {W > 0 && <GiftStage W={W - 20} gifts={pos.map(x => ({ ...x, k: gby[x.id].k }))} anim={anim} ava={q.avatar} onGift={id2 => openGift(gby[id2])} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6, paddingHorizontal: 6 }}>
            <Text style={st.name}>{q.name || '…'}</Text>
            {nickG && <Press pop round={14} onPress={() => openGift(nickG)} style={{ marginLeft: 4 }}><Image source={{ uri: giftImg(nickG.k) }} style={{ width: 28, height: 28 }} contentFit="contain" /></Press>}
            <Vf on={q.verified} size={22} />
          </View>
          {!!(p && p.wallets && p.wallets.length) && (
            <View style={{ alignItems: 'center', marginTop: 6 }}>
              <View style={st.wal}>
                <View style={{ flexDirection: 'row' }}>{p.wallets.slice(0, 3).map((w, i) => <View key={w.id} style={[st.wi, { marginLeft: i ? -6 : 0, backgroundColor: { ton: '#0098ea', eth: '#627eea', btc: '#f7931a', trx: '#eb0029', sol: '#14f195' }[w.chain] || '#8b5cf6' }]}><Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{(w.sym || '?').slice(0, 1)}</Text></View>)}</View>
                <Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '700', marginLeft: 7 }}>{p.wallets.length === 1 ? p.wallets[0].name : p.wallets.length + ' ' + (p.wallets.length < 5 ? 'кошелька' : 'кошельков')}</Text>
              </View>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
            {(own || q.online) && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ade80', marginRight: 5 }} />}
            <Text style={st.seen}>{own ? 'в сети' : seen(q)}</Text>
          </View>
        </View>

        {/* кнопки — как на сайте */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {own ? <>
            <Act ic="pencil-outline" t="Изменить" onPress={() => navigation.navigate('EditMe')} />
            <Act ic="star-outline" t="Подарки" onPress={() => setSheet({ t: 'shop' })} />
          </> : <>
            <Act ic="chatbubble-ellipses-outline" t="Написать" onPress={() => navigation.navigate('Chat', { c: cidOf(id), peer: String(id) })} />
            <Act ic="star-outline" t="Подарить" onPress={() => setSheet({ t: 'shop', to: id })} />
            {p && p.tg && <Act ic="paper-plane-outline" t="Telegram" onPress={() => p.tg.username && Linking.openURL('https://t.me/' + p.tg.username)} />}
          </>}
          <Act ic="copy-outline" t={'ID ' + id} onPress={() => { Clipboard.setStringAsync(String(id)); toast('ID ' + id + ' скопирован'); }} />
          {!own && meAdmin && <Act ic="diamond-outline" t="Управлять" onPress={() => Linking.openURL(BASE + '/#u-' + id)} />}
        </View>

        {/* о себе · telegram · почта · в Mundora */}
        {!!p && (
          <View style={[st.card, { paddingVertical: 4 }]}>
            {[p.bio ? { l: 'о себе', v: p.bio } : null,
              p.tg ? { l: 'telegram', v: p.tg.username ? '@' + p.tg.username : p.tg.name || 'привязан', link: 1, fn: () => p.tg.username && Linking.openURL('https://t.me/' + p.tg.username) } : null,
              p.email ? { l: own ? 'почта · нажми, чтобы сменить' : 'почта', v: p.email, lock: 1, fn: own ? () => Linking.openURL(BASE + '/#u-' + id) : null } : null,
              joined ? { l: 'в Mundora', v: 'с ' + joined } : null].filter(Boolean).map((r, k) => (
              <Pressable key={r.l} onPress={r.fn} disabled={!r.fn} style={[{ paddingVertical: 11 }, k > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.07)' }]}>
                <Text style={st.lbl}>{r.l}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {r.lock ? <Ionicons name="lock-closed-outline" size={14} color="#fff" style={{ marginRight: 6 }} /> : null}
                  <Text style={[st.val, r.link && { color: '#7cc4ff' }, r.l === 'о себе' && { fontWeight: '400', lineHeight: 21 }]}>{r.v}</Text>
                  {own && r.lock ? <Ionicons name="pencil" size={13} color="#fff" style={{ marginLeft: 6 }} /> : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}

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
              <View style={{ flex: 1 }} />
              <Press pop round={16} onPress={() => setSheet(own ? { t: 'shop' } : { t: 'shop', to: id })}>
                <View style={st.ghost}><Ionicons name={own ? 'add' : 'star-outline'} size={16} color="#fff" /><Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', marginLeft: 5 }}>{own ? 'Купить' : 'Подарить'}</Text></View>
              </Press>
            </View>
            {gifts.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                {gifts.map(g => {
                  const r = giftRar(g.k), pinned = (p.pos || []).some(x => x.id === g.id) || p.nick === g.id;
                  return (
                    <View key={g.id} style={{ width: '33.33%', padding: 4 }}>
                      <Press pop round={18} amt={0.06} onPress={() => openGift(g)}>
                        <View style={st.gift}>
                          <LinearGradient colors={[r.gl, 'rgba(255,255,255,.03)']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
                          <Image source={{ uri: giftImg(g.k) }} style={{ width: 62, height: 62 }} contentFit="contain" />
                          <Text numberOfLines={2} style={{ color: '#fff', fontSize: 12.5, fontWeight: '700', textAlign: 'center', marginTop: 4 }}>{(GIFT_CAT[g.k] || {}).n || 'Подарок'}</Text>
                          <Text numberOfLines={1} style={{ color: C.sub, fontSize: 11.5 }}>{g.from ? 'от ' + g.from.name : 'куплен'}</Text>
                          {pinned && <Ionicons name="pin" size={13} color="#fff" style={{ position: 'absolute', top: 7, right: 7, opacity: 0.8 }} />}
                        </View>
                      </Press>
                    </View>
                  );
                })}
              </View>
            ) : <Text style={{ color: C.sub, fontSize: 14, paddingVertical: 4 }}>{own ? 'Пока нет подарков. Купи за очки опыта — они появятся вокруг аватарки.' : 'Пока нет подарков — подари первым.'}</Text>}
          </View>
        )}

        {/* капитализация */}
        {!!cap && (
          <View style={[st.card, { borderRadius: 26, padding: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ring pct={pct} level={cap.level} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: C.sub, fontSize: 12.5 }}>Капитализация · рейтинг</Text>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{cap.title}</Text>
                <Text style={{ color: C.lav, fontSize: 13.5 }}>{cap.to == null ? 'Максимальный уровень' : 'до ' + (cap.level + 1) + ' ур. — ' + fmt(cap.to - cap.score) + ' XP'}</Text>
              </View>
            </View>
            <View style={st.bar}><LinearGradient colors={['#8b5cf6', '#c084fc']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: pct + '%', height: '100%', borderRadius: 99 }} /></View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              {[['Заработано', '+' + fmt(cap.earned ?? cap.score), '#4ade80', 'XP за всё время'], ['Потрачено', cap.spent ? '−' + fmt(cap.spent) : '0', '#f87171', 'на подарки'], ['Рейтинг', fmt(cap.score), '#fff', 'XP · доступно на подарки']].map(([l, v, c, s2], k) => (
                <View key={l} style={[st.tile, k === 2 && { backgroundColor: 'rgba(139,92,246,.16)', borderColor: 'rgba(139,92,246,.35)' }]}>
                  <Text style={{ color: C.sub, fontSize: 12 }}>{l}</Text>
                  <Text style={{ color: c, fontSize: 18, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
                  <Text style={{ color: C.sub, fontSize: 10.5, marginTop: 1 }} numberOfLines={2}>{s2}</Text>
                </View>
              ))}
            </View>
            {(() => {
              const gs = gifts.filter(g => GIFT_CAT[g.k]); if (!gs.length) return null;
              const val = gs.reduce((n, g) => n + GIFT_CAT[g.k].p, 0), topG = [...gs].sort((a, b) => GIFT_CAT[b.k].p - GIFT_CAT[a.k].p).slice(0, 4), rr = giftRar(topG[0].k);
              return (
                <View style={st.gv}>
                  <LinearGradient colors={[rr.gl, 'rgba(255,255,255,.03)']} start={{ x: 0, y: 0.5 }} end={{ x: 0.6, y: 0.5 }} style={StyleSheet.absoluteFill} />
                  <View style={{ flexDirection: 'row' }}>{topG.map((g, i) => <Image key={g.id} source={{ uri: giftImg(g.k) }} style={{ width: 34, height: 34, marginLeft: i ? -10 : 0, zIndex: 9 - i }} contentFit="contain" />)}</View>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={{ color: C.sub, fontSize: 12 }}>Ценность подарков</Text>
                    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{fmt(val)} XP</Text>
                    <Text style={{ color: C.lav, fontSize: 12 }} numberOfLines={1}>{gs.length} шт. · самый ценный — {GIFT_CAT[topG[0].k].n}</Text>
                  </View>
                </View>
              );
            })()}
            <Pressable onPress={() => { tap(); setMore(m => !m); }} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
              <Text style={{ color: C.lav, fontSize: 13.5, fontWeight: '600' }}>Уровни и откуда опыт</Text>
              <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={15} color={C.lav} style={{ marginLeft: 4 }} />
            </Pressable>
            {more && (
              <View style={{ marginTop: 10 }}>
                {!!cap.ladder && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{cap.ladder.map((f, i) => {
                  const on = i + 1 === cap.level, done = i + 1 < cap.level;
                  return <View key={i} style={[st.lad, done && { backgroundColor: 'rgba(139,92,246,.18)' }, on && { backgroundColor: '#8b5cf6' }]}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{i + 1}</Text><Text style={{ color: on ? '#fff' : C.sub, fontSize: 10 }}>{i + 1 === cap.ladder.length ? kXP(f) + '+' : kXP(f) + '–' + kXP(cap.ladder[i + 1])}</Text></View>;
                })}</View>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {(cap.parts || []).map(([n, v]) => <View key={n} style={st.part}><Text style={{ color: C.lav, fontSize: 12.5 }}>{n} <Text style={{ color: '#fff', fontWeight: '700' }}>+{fmt(v)}</Text></Text></View>)}
                  {!!cap.spent && <View style={st.part}><Text style={{ color: '#f87171', fontSize: 12.5 }}>Подарки <Text style={{ fontWeight: '700' }}>−{fmt(cap.spent)}</Text></Text></View>}
                </View>
              </View>
            )}
          </View>
        )}

        {/* статистика */}
        {!!cap && cap.stats && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 8 }}>
            {[['gift_planet', cap.stats.likes, 'лайков'], ['folder', cap.stats.playlists, 'плейлистов'], ['orbit', cap.stats.plays, 'прослушиваний'], ['planet', cap.stats.days, 'дней в Mundora']].map(([img, v, l]) => (
              <View key={l} style={{ width: '50%', padding: 6 }}>
                <View style={[st.card, { marginTop: 0, padding: 14 }]}>
                  <Image source={{ uri: BASE + '/img/' + img + '.webp' }} style={{ width: 40, height: 40, marginBottom: 4 }} contentFit="contain" />
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{fmt(v)}</Text>
                  <Text style={{ color: C.sub, fontSize: 13 }}>{l}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        {footer}
      </ScrollView>
      {sheet && <GiftSheet sheet={sheet} setSheet={setSheet} prof={p} own={own} onChanged={load} />}
    </View>
  );
}

// кольцо уровня (conic-gradient на сайте)
function Ring({ pct, level }) {
  const r = 33, L = 2 * Math.PI * r;
  return (
    <View style={{ width: 74, height: 74, alignItems: 'center', justifyContent: 'center', shadowColor: '#8b5cf6', shadowOpacity: 0.45, shadowRadius: 12 }}>
      <Svg width={74} height={74} style={StyleSheet.absoluteFill}>
        <Circle cx={37} cy={37} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={7} fill="none" />
        <Circle cx={37} cy={37} r={r} stroke="#c084fc" strokeWidth={7} fill="none" strokeDasharray={`${L * pct / 100} ${L}`} strokeLinecap="round" transform="rotate(-90 37 37)" />
      </Svg>
      <LinearGradient colors={['#8b5cf6', '#4c1d95']} start={{ x: 0.3, y: 0.2 }} end={{ x: 0.8, y: 1 }} style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', lineHeight: 26 }}>{level}</Text>
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>ур.</Text>
      </LinearGradient>
    </View>
  );
}

// Мыльный пузырь (как на сайте: прозрачный, блик сверху слева, переливающийся край)
function BubbleSkin({ sz, k }) {
  return (
    <View style={{ width: sz, height: sz, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={sz} height={sz} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="b" cx="50%" cy="50%" r="50%"><Stop offset="0.72" stopColor="#fff" stopOpacity="0.03" /><Stop offset="0.9" stopColor="#c4b5fd" stopOpacity="0.22" /><Stop offset="1" stopColor="#67e8f9" stopOpacity="0.45" /></RadialGradient>
          <RadialGradient id="h" cx="30%" cy="24%" r="18%"><Stop offset="0" stopColor="#fff" stopOpacity="0.75" /><Stop offset="0.55" stopColor="#fff" stopOpacity="0.12" /><Stop offset="1" stopColor="#fff" stopOpacity="0" /></RadialGradient>
        </Defs>
        <Circle cx={sz / 2} cy={sz / 2} r={sz / 2 - 0.6} fill="url(#b)" stroke="rgba(255,255,255,.32)" strokeWidth={1} />
        <Circle cx={sz / 2} cy={sz / 2} r={sz / 2} fill="url(#h)" />
        <Ellipse cx={sz * 0.7} cy={sz * 0.78} rx={sz * 0.12} ry={sz * 0.05} fill="rgba(255,255,255,.18)" transform={`rotate(-35 ${sz * 0.7} ${sz * 0.78})`} />
      </Svg>
      <Image source={{ uri: giftImg(k) }} style={{ width: sz * 0.46, height: sz * 0.46 }} contentFit="contain" />
    </View>
  );
}

// Сцена подарков вокруг аватарки: none — стоят где расставлены, bubbles — живые пузыри, orbit — 3D-орбита
function GiftStage({ W, gifts, anim, ava, onGift }) {
  const H = STAGE_H, cx = W / 2, cy = H / 2, AR = 56;
  const B = useMemo(() => gifts.map((g, i) => {
    const h = hsh(g.id || i), dep = 0.78 + (h % 60) / 100, sz = anim === 'bubbles' ? Math.round(50 * dep) : 52, a = (h % 628) / 100;
    return { g, sz, r: sz / 2, m: dep * dep, x: (g.x / 100) * W, y: (g.y / 100) * H, vx: Math.cos(a) * 24, vy: Math.sin(a) * 24, ph: (h % 600) / 100,
      th: i * Math.PI * 2 / Math.max(1, gifts.length) + (h % 100) / 300, w: Math.PI * 2 / (13 + (h % 5)), rr: (h % 5) * 7, z: 0, sq: 0,
      tx: new Animated.Value((g.x / 100) * W - sz / 2), ty: new Animated.Value((g.y / 100) * H - sz / 2), sx: new Animated.Value(1), sy: new Animated.Value(1), op: new Animated.Value(1) };
  }), [gifts.map(g => g.id + g.x + g.y).join(), W, anim]);
  const drag = useRef(null);
  useEffect(() => {
    if (anim === 'none' || !B.length) return;
    let raf, last = Date.now(), t0 = Date.now();
    const tick = () => {
      const now = Date.now(), dt = Math.min(0.04, (now - last) / 1000); last = now; const t = (now - t0) / 1000;
      if (anim === 'orbit') {
        const Rx = Math.min(W * 0.44, 190), Ry = H * 0.6 * 0.5;
        B.forEach((p, i) => {
          const a = t * (Math.PI * 2 / 16) + i * Math.PI * 2 / B.length, c = Math.cos(a), sn = Math.sin(a), dep = (sn + 1) / 2;
          const sc = 0.6 + dep * 0.8;
          p.tx.setValue(cx + c * Rx - p.r); p.ty.setValue(cy + sn * Ry - 6 - p.r); p.sx.setValue(sc); p.sy.setValue(sc); p.op.setValue(0.45 + dep * 0.55);
        });
      } else {
        const Lb = { l: 6, t: 6, r: W - 6, b: H + 80 };
        for (const p of B) {
          if (drag.current && drag.current.p === p) continue;
          p.th += p.w * dt;
          const Rx = Math.min(W / 2 - p.r - 4, AR + 28 + p.rr), Ry = Rx * 0.42, tx = cx + Math.cos(p.th) * Rx, ty = cy + 8 + Math.sin(p.th) * Ry;
          p.vx += ((tx - p.x) * 5.5 - p.vx * 2.4 + (Math.random() - 0.5) * 30) * dt; p.vy += ((ty - p.y) * 5.5 - p.vy * 2.4 + (Math.random() - 0.5) * 30) * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const e = 0.82;
          if (p.x < Lb.l + p.r) { p.x = Lb.l + p.r; p.vx = Math.abs(p.vx) * e; } if (p.x > Lb.r - p.r) { p.x = Lb.r - p.r; p.vx = -Math.abs(p.vx) * e; }
          if (p.y < Lb.t + p.r) { p.y = Lb.t + p.r; p.vy = Math.abs(p.vy) * e; } if (p.y > Lb.b - p.r) { p.y = Lb.b - p.r; p.vy = -Math.abs(p.vy) * e; }
        }
        // упругие столкновения с массой
        for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
          const a = B[i], b = B[j]; if (Math.abs(a.z - b.z) > 0.9) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, md = (a.r + b.r) * 0.92;
          if (d < md) {
            const nx = dx / d, ny = dy / d, o = md - d, ma = drag.current && drag.current.p === a ? 1e9 : a.m, mb = drag.current && drag.current.p === b ? 1e9 : b.m, ta = mb / (ma + mb), tb = ma / (ma + mb);
            a.x -= nx * o * ta; a.y -= ny * o * ta; b.x += nx * o * tb; b.y += ny * o * tb;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) { const jn = -1.85 * rv / (1 / ma + 1 / mb); a.vx -= jn / ma * nx; a.vy -= jn / ma * ny; b.vx += jn / mb * nx; b.vy += jn / mb * ny; a.sq = b.sq = Math.min(1, Math.abs(rv) / 80 + 0.3); }
          }
        }
        for (const p of B) {
          p.sq = Math.max(0, p.sq - dt * 2.2);
          const wob = Math.sin(t * 2.4 + p.ph) * 0.03 + p.sq * Math.sin(t * 22) * 0.09;
          const dragging = drag.current && drag.current.p === p; p.z = dragging ? 1 : Math.sin(p.th);
          const back = p.z < -0.15, ds = 0.68 + (p.z + 1) * 0.24;
          p.tx.setValue(p.x - p.r); p.ty.setValue(p.y - p.r); p.sx.setValue((1 + wob) * ds); p.sy.setValue((1 - wob) * ds); p.op.setValue(back ? 0.55 + (p.z + 1) * 0.4 : 1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [B, anim]);

  return (
    <View style={{ width: W, height: H }}>
      {/* задний слой: пузыри «за» аватаркой рисуются под ней — тут просто полупрозрачнее и мельче */}
      <View style={{ position: 'absolute', left: cx - 60, top: cy - 60, width: 120, height: 120, borderRadius: 60, padding: 4, backgroundColor: 'rgba(255,255,255,.08)', shadowColor: '#7c3aed', shadowOpacity: 0.8, shadowRadius: 25, shadowOffset: { width: 0, height: 14 }, elevation: 12, zIndex: 2 }}>
        <Image source={authed(avaUri(ava))} style={{ width: 112, height: 112, borderRadius: 56 }} contentFit="cover" />
      </View>
      {B.map(p => <GiftBubble key={p.g.id} p={p} anim={anim} drag={drag} W={W} H={H} onTap={() => onGift(p.g.id)} />)}
    </View>
  );
}

function GiftBubble({ p, anim, drag, W, H, onTap }) {
  const pr = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => anim !== 'bubbles',
    onPanResponderGrant: () => { if (anim !== 'bubbles') return; drag.current = { p, x0: p.x, y0: p.y, hist: [], moved: 0 }; },
    onPanResponderMove: (_, g) => {
      const D = drag.current; if (!D || D.p !== p) return;
      p.x = Math.max(p.r + 6, Math.min(W - 6 - p.r, D.x0 + g.dx)); p.y = Math.max(p.r + 6, Math.min(H + 80 - p.r, D.y0 + g.dy));
      D.moved = Math.max(D.moved, Math.hypot(g.dx, g.dy)); p.vx = g.vx * 1000; p.vy = g.vy * 1000;
      p.tx.setValue(p.x - p.r); p.ty.setValue(p.y - p.r);
    },
    onPanResponderRelease: (_, g) => {
      const D = drag.current; drag.current = null;
      if (D && D.moved > 6) { let vx = g.vx * 1000, vy = g.vy * 1000; const sp = Math.hypot(vx, vy); if (sp > 900) { vx *= 900 / sp; vy *= 900 / sp; } p.vx = vx; p.vy = vy; return; }
      onTap();
    },
    onPanResponderTerminate: () => { drag.current = null; },
  }), [p, anim]);
  return (
    <Animated.View {...pr.panHandlers} style={{ position: 'absolute', left: 0, top: 0, width: p.sz, height: p.sz, zIndex: 3, opacity: p.op, transform: [{ translateX: p.tx }, { translateY: p.ty }, { scaleX: p.sx }, { scaleY: p.sy }] }}>
      {anim === 'bubbles' ? <BubbleSkin sz={p.sz} k={p.g.k} /> : <Image source={{ uri: giftImg(p.g.k) }} style={{ width: p.sz, height: p.sz }} contentFit="contain" />}
    </Animated.View>
  );
}

// Шторки подарков: магазин → выбор → покупка/подарок; просмотр подарка (от кого, дата, «у ника»)
function GiftSheet({ sheet, setSheet, prof, own, onChanged }) {
  const ins = useSafeAreaInsets();
  const a = useRef(new Animated.Value(0)).current;
  const [bal, setBal] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { a.setValue(0); Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 7 }).start(); }, [sheet.t, sheet.k]);
  useEffect(() => { people('id=' + M.me).then(j => setBal(j.profile && j.profile.capital ? j.profile.capital.avail || 0 : 0)).catch(() => setBal(0)); }, []);
  const close = () => Animated.timing(a, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setSheet(null));
  const to = sheet.to && String(sheet.to) !== String(M.me) ? sheet.to : null;
  const toName = to ? ((S.peers[to] || {}).name || (prof && prof.name) || 'ID ' + to) : '';
  async function buy(k) {
    setBusy(true);
    try { await req('/api/people?a=gift-buy', { k, to }); toast(to ? 'Подарок отправлен' : 'Подарок в профиле'); onChanged(); close(); }
    catch (e) { toast(e.message, 1); }
    setBusy(false);
  }
  async function nick(g) {
    try { await req('/api/people?a=gift-layout', { nick: prof.nick === g.id ? null : g.id }); toast(prof.nick === g.id ? 'Убрано у ника' : 'Подарок у ника'); onChanged(); close(); } catch (e) { toast(e.message, 1); }
  }
  const H = Dimensions.get('window').height;
  let body = null;
  if (sheet.t === 'shop') {
    body = (<>
      <Text style={sh.h}>{to ? 'Подарок для ' + toName : 'Магазин подарков'}</Text>
      <View style={sh.bal}><Image source={{ uri: BASE + '/img/money.webp' }} style={{ width: 40, height: 40 }} contentFit="contain" /><View style={{ marginLeft: 10 }}><Text style={{ color: C.sub, fontSize: 12.5 }}>Доступно для подарков</Text><Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{bal == null ? '…' : fmt(bal) + ' XP'}</Text></View></View>
      <Text style={{ color: C.sub, fontSize: 13, marginBottom: 12 }}>XP копятся за лайки, прослушивания, плейлисты, заметки и дни в Mundora. Покупка не понижает уровень.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
        {Object.entries(GIFT_CAT).map(([k, g]) => { const r = giftRar(k), no = bal != null && bal < g.p; return (
          <View key={k} style={{ width: '33.33%', padding: 4 }}>
            <Press pop round={18} amt={0.06} onPress={() => setSheet({ ...sheet, t: 'pick', k })}>
              <View style={[sh.it, no && { opacity: 0.45 }]}>
                <LinearGradient colors={[r.gl, 'rgba(255,255,255,.03)']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
                <Image source={{ uri: giftImg(k) }} style={{ width: 62, height: 62 }} contentFit="contain" />
                <Text numberOfLines={2} style={{ color: '#fff', fontSize: 12.5, fontWeight: '700', textAlign: 'center' }}>{g.n}</Text>
                <Text style={{ color: C.sub, fontSize: 11 }}>{r.n}</Text>
                <View style={sh.pr}><Text style={{ color: '#fff', fontSize: 11.5, fontWeight: '700' }}>{fmt(g.p)} XP</Text></View>
              </View>
            </Press>
          </View>
        ); })}
      </View>
    </>);
  } else if (sheet.t === 'pick' || sheet.t === 'view') {
    const g = sheet.g, k = sheet.t === 'pick' ? sheet.k : g.k, G = GIFT_CAT[k] || { n: 'Подарок', p: 0 }, r = giftRar(k);
    body = (
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Svg width={150} height={150} style={StyleSheet.absoluteFill}><Defs><RadialGradient id="g" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={r.gl.replace(/rgba\((\d+),(\d+),(\d+),[^)]+\)/, 'rgb($1,$2,$3)')} stopOpacity="0.7" /><Stop offset="0.68" stopColor="#000" stopOpacity="0" /></RadialGradient></Defs><Circle cx={75} cy={75} r={75} fill="url(#g)" /></Svg>
          <Image source={{ uri: giftImg(k) }} style={{ width: 120, height: 120 }} contentFit="contain" />
        </View>
        <Text style={[sh.h, { textAlign: 'center', marginTop: 4 }]}>{G.n}</Text>
        <Text style={{ color: C.lav, fontSize: 14 }}>{r.n}{sheet.t === 'view' ? ' · ' + fmt(G.p) + ' XP' : ''}</Text>
        {sheet.t === 'pick' ? (<>
          <Text style={{ color: C.sub, fontSize: 13.5, textAlign: 'center', marginVertical: 14 }}>{to ? 'Подарок появится в профиле ' + toName + ' с твоим именем.' : 'Подарок появится в твоём профиле и сразу встанет у аватарки, если есть свободное место.'}</Text>
          <Press pop round={26} amt={0.05} onPress={() => buy(k)} disabled={busy} style={{ alignSelf: 'stretch' }}>
            <LinearGradient colors={['#8b5cf6', '#6d28d9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sh.btn}>{busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="star" size={17} color="#fff" /><Text style={sh.btnT}>{to ? 'Подарить' : 'Купить'} за {fmt(G.p)} XP</Text></>}</LinearGradient>
          </Press>
          <Press pop round={26} amt={0.04} onPress={() => setSheet({ ...sheet, t: 'shop' })} style={{ alignSelf: 'stretch', marginTop: 8 }}><View style={[sh.btn, { backgroundColor: 'rgba(255,255,255,.07)' }]}><Text style={sh.btnT}>Назад</Text></View></Press>
        </>) : (<>
          <View style={[st.card, { alignSelf: 'stretch', paddingVertical: 4 }]}>
            <View style={{ paddingVertical: 11 }}><Text style={st.lbl}>{g.from ? 'от кого' : 'получен'}</Text><Text style={st.val}>{g.from ? g.from.name : 'куплен за XP'}</Text></View>
            <View style={{ paddingVertical: 11, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.07)' }}><Text style={st.lbl}>дата</Text><Text style={st.val}>{new Date(g.t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</Text></View>
          </View>
          {own && <Press pop round={26} amt={0.04} onPress={() => nick(g)} style={{ alignSelf: 'stretch', marginTop: 12 }}><View style={[sh.btn, { backgroundColor: 'rgba(255,255,255,.07)' }]}><Text style={sh.btnT}>{prof && prof.nick === g.id ? 'Убрать у ника' : 'Поставить у ника'}</Text></View></Press>}
        </>)}
      </View>
    );
  }
  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={close}><Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,.5)', opacity: a }]} /></Pressable>
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: H * 0.88, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [H * 0.6, 0] }) }] }}>
        <View style={sh.panel}>
          <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.25)', marginBottom: 10 }} />
          <Pressable onPress={close} hitSlop={10} style={{ position: 'absolute', right: 14, top: 14, zIndex: 2 }}><Ionicons name="close" size={22} color="#fff" /></Pressable>
          <ScrollView contentContainerStyle={{ paddingBottom: ins.bottom + 20 }}>{body}</ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, overflow: 'hidden', paddingVertical: 18, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', alignItems: 'center' },
  name: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  wal: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingLeft: 5, paddingRight: 10, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', backgroundColor: 'rgba(18,10,36,.45)' },
  wi: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#1a1030' },
  seen: { color: '#b9b0d6', fontSize: 14, textAlign: 'center' },
  act: { height: 62, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,.07)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  actT: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 5 },
  card: { marginTop: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,.1)', paddingHorizontal: 16, paddingVertical: 13 },
  lbl: { color: '#9c94bb', fontSize: 12.5, marginBottom: 2 },
  val: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  ghost: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', backgroundColor: 'rgba(255,255,255,.05)' },
  gift: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', minHeight: 128 },
  bar: { height: 10, borderRadius: 99, backgroundColor: 'rgba(255,255,255,.07)', marginTop: 14, overflow: 'hidden' },
  tile: { flex: 1, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  gv: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' },
  lad: { width: 56, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.05)', alignItems: 'center' },
  part: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.05)' },
});
const sh = StyleSheet.create({
  panel: { backgroundColor: '#15101f', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', paddingHorizontal: 16, paddingTop: 10 },
  h: { color: '#fff', fontSize: 19, fontWeight: '800', marginBottom: 12, marginRight: 30 },
  bal: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', marginBottom: 10 },
  it: { alignItems: 'center', paddingTop: 12, paddingBottom: 10, paddingHorizontal: 6, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', minHeight: 150 },
  pr: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(0,0,0,.35)' },
  btn: { height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700', marginLeft: 6 },
});
