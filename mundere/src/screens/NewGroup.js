// Создание группы/канала, добавление участников и редактирование — один экран, как в Telegram.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, KeyboardAvoidingView, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, useStore, emit } from '../store';
import { M, ms, people } from '../api';
import { C, Glass, GlassBtn, Press, Avatar, GAvatar, Vf, seen, gN, bubble, toast, tap } from '../ui';

export default function NewGroup({ route, navigation }) {
  useStore();
  const { type, add, edit, have } = route.params, ch = type === 'channel', ins = useSafeAreaInsets();
  const g0 = edit ? S.G[edit] || {} : {};
  const [step, setStep] = useState(edit ? 'info' : add ? 'pick' : ch ? 'info' : 'pick');
  const [sel, setSel] = useState(new Map());
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [title, setTitle] = useState(g0.title || '');
  const [about, setAbout] = useState(g0.about || '');
  const [ava, setAva] = useState(null); // data:image/jpeg;base64,… или '' — удалить
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const tm = setTimeout(async () => { try { const j = await people('q=' + encodeURIComponent(q.trim())); setFound(j.people || []); for (const p of j.people || []) S.peers[p.id] = S.peers[p.id] || p; } catch (e) {} }, 260);
    return () => clearTimeout(tm);
  }, [q]);

  const ex = new Set((have || []).map(String));
  const cands = useMemo(() => {
    const known = [...new Set(S.chats.filter(c => c.p != null && String(c.p) !== String(M.me)).map(c => String(c.p)))].map(id => S.peers[id]).filter(Boolean);
    const all = [...known, ...found.filter(p => !known.some(k => String(k.id) === String(p.id)))];
    const ql = q.trim().toLowerCase();
    return all.filter(p => !ex.has(String(p.id)) && String(p.id) !== String(M.me) && (!ql || p.name.toLowerCase().includes(ql) || String(p.id) === ql || found.some(f => String(f.id) === String(p.id))));
  }, [q, found, S.chats]);

  const toggle = p => { tap(); setSel(m => { const n = new Map(m); const k = String(p.id); if (n.has(k)) n.delete(k); else if (n.size < 199) n.set(k, p); return n; }); };

  async function pickAva(cam) {
    const pr = cam ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!pr.granted) return toast('Нет доступа', 1);
    const opt = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
    const r = cam ? await ImagePicker.launchCameraAsync(opt) : await ImagePicker.launchImageLibraryAsync(opt);
    if (r.canceled) return;
    const m = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 320, height: 320 } }], { compress: 0.84, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    setAva('data:image/jpeg;base64,' + m.base64);
  }
  const avaMenu = e => bubble({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, [
    { t: 'Выбрать из галереи', ic: 'images-outline', fn: () => pickAva(0) },
    { t: 'Сделать фото', ic: 'camera-outline', fn: () => pickAva(1) },
    ...((ava || (g0.av && ava !== '')) ? ['-', { t: 'Удалить фото', ic: 'trash-outline', red: 1, fn: () => setAva('') }] : []),
  ]);

  async function next() {
    if (busy) return;
    if (add) {
      if (!sel.size) return;
      setBusy(true);
      try { const j = await ms('gadd', { c: add, ids: [...sel.keys()] }); S.G[add] = j.g; emit(); toast(ch ? 'Подписчики добавлены' : 'Участники добавлены'); navigation.goBack(); } catch (e) { toast(e.message, 1); }
      return setBusy(false);
    }
    if (edit) {
      setBusy(true);
      try { const j = await ms('gedit', { c: edit, title, about, ...(ava != null ? { ava: ava } : {}) }); S.G[edit] = j.g; emit(); toast('Сохранено'); navigation.goBack(); } catch (e) { toast(e.message, 1); }
      return setBusy(false);
    }
    if (step === 'pick' && !ch) return setStep('info');
    if (step === 'info' && ch) { if (!title.trim()) return; return setStep('pick'); }
    if (!title.trim()) return setStep('info');
    setBusy(true);
    try {
      const j = await ms('gnew', { type, title: title.trim(), about: about.trim(), ids: [...sel.keys()], ...(ava ? { ava } : {}) });
      S.G[j.c] = j.g; emit();
      navigation.replace('Chat', { c: j.c });
    } catch (e) { toast(e.message, 1); setBusy(false); }
  }
  const back = () => {
    if (!add && !edit && step === 'info' && !ch) return setStep('pick');
    if (!add && !edit && step === 'pick' && ch) return setStep('info');
    navigation.goBack();
  };
  const ttl = edit ? '' : add ? (ch ? 'Добавить подписчиков' : 'Добавить участников') : ch ? 'Новый канал' : 'Новая группа';
  const okNext = step === 'pick' ? (add ? sel.size > 0 : true) : !!title.trim();
  const nextLabel = add ? 'Добавить' : (step === 'info' && !ch) || (step === 'pick' && ch) ? 'Создать' : 'Далее';

  const header = (
    <View style={{ paddingTop: ins.top + 6, paddingHorizontal: 10, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
      <GlassBtn icon={edit || add || (step === 'pick' && !ch) || (step === 'info' && ch) ? 'close' : 'chevron-back'} onPress={back} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        {!!ttl && <Glass round={22} style={{ height: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{ttl}</Text>
          {step === 'pick' && <Text style={{ color: C.mute, fontSize: 12 }}>{sel.size ? sel.size + ' из 200' : ch ? 'можно пропустить' : 'до 200 участников'}</Text>}
        </Glass>}
      </View>
      {edit ? <GlassBtn icon="checkmark" fill={C.blue} onPress={next} /> : (
        <Press onPress={next} disabled={!okNext || busy}>
          <View style={{ height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{nextLabel}</Text></View>
        </Press>
      )}
    </View>
  );

  if (step === 'info') {
    const src = ava ? ava : ava === '' ? null : undefined;
    return (
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
        {header}
        <View style={{ paddingHorizontal: 14 }}>
          <Press onPress={avaMenu} style={{ alignSelf: 'center', alignItems: 'center', marginVertical: 14 }}>
            {src || (src === undefined && g0.av) ? <GAvatar g={g0} src={src} size={100} /> : (
              <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#16263b', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="camera" size={42} color="#3e88f7" /></View>
            )}
            <Text style={{ color: C.blue, fontSize: 15, marginTop: 8 }}>{src || g0.av ? 'Изменить фото' : 'Выбрать фотографию'}</Text>
          </Press>
          <View style={{ backgroundColor: C.card, borderRadius: 18, overflow: 'hidden' }}>
            <TextInput value={title} onChangeText={setTitle} placeholder={ch ? 'Название канала' : 'Название группы'} placeholderTextColor={C.mute} maxLength={64} autoFocus={!edit} style={{ color: '#fff', fontSize: 17, height: 52, paddingHorizontal: 16 }} selectionColor={C.blue} />
            <View style={{ height: 1, backgroundColor: C.line, marginLeft: 16 }} />
            <TextInput value={about} onChangeText={setAbout} placeholder="Описание (необязательно)" placeholderTextColor={C.mute} maxLength={255} multiline style={{ color: '#fff', fontSize: 17, minHeight: 52, paddingHorizontal: 16, paddingVertical: 14 }} selectionColor={C.blue} />
          </View>
          {!edit && <Text style={{ color: C.mute, fontSize: 13, marginTop: 10, marginHorizontal: 6, lineHeight: 18 }}>{ch ? 'Писать в канал могут только администраторы.' : 'Участники смогут писать, отправлять фото и голосовые.'}</Text>}
          {!edit && sel.size > 0 && <Text style={{ color: C.mute, fontSize: 13, marginTop: 18, marginLeft: 6, textTransform: 'uppercase' }}>{gN({ type }, sel.size)}</Text>}
          {!edit && [...sel.values()].slice(0, 6).map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6 }}><Avatar p={p} size={40} /><Text style={{ color: '#fff', fontSize: 16, marginLeft: 12 }}>{p.name}</Text></View>
          ))}
        </View>
      </KeyboardAvoidingView>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {header}
      <View style={{ paddingHorizontal: 12 }}>
        <Glass round={18} style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6, alignItems: 'center' }}>
          {[...sel.values()].map(p => (
            <Press key={p.id} onPress={() => toggle(p)} style={{ margin: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(47,140,255,.25)', borderRadius: 16, paddingRight: 8 }}><Avatar p={p} size={28} /><Text style={{ color: '#fff', marginLeft: 6 }}>{p.name.split(' ')[0]}</Text><Ionicons name="close" size={14} color="#fff" style={{ marginLeft: 4 }} /></View>
            </Press>
          ))}
          <TextInput value={q} onChangeText={setQ} placeholder="Кого добавить? Ник или ID" placeholderTextColor={C.mute} style={{ flex: 1, minWidth: 150, color: '#fff', fontSize: 16, height: 38, paddingHorizontal: 8 }} selectionColor={C.blue} />
        </Glass>
      </View>
      <FlatList
        data={cands}
        keyExtractor={p => String(p.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40, paddingTop: 6 }}
        ListEmptyComponent={<Text style={{ color: C.mute, textAlign: 'center', marginTop: 40 }}>{q ? 'Никого не нашли' : 'Введи ник или ID человека'}</Text>}
        renderItem={({ item: p }) => {
          const on = sel.has(String(p.id));
          return (
            <Press scale={0.98} onPress={() => toggle(p)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.6, borderColor: on ? C.blue : 'rgba(255,255,255,.35)', backgroundColor: on ? C.blue : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>{on && <Ionicons name="checkmark" size={15} color="#fff" />}</View>
              <Avatar p={p} size={44} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{p.name}</Text><Vf on={p.verified} size={14} /></View>
                <Text style={{ color: C.mute, fontSize: 13 }}>{seen(p)} · ID {p.id}</Text>
              </View>
            </Press>
          );
        }}
      />
    </View>
  );
}
