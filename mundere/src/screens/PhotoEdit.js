// Предпросмотр и редактор фото перед отправкой (как в Telegram):
// кадр (пропорции, поворот, отражение), рисование кистью, текст, подпись и отправка.
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, PanResponder, Dimensions, KeyboardAvoidingView, ActivityIndicator, ScrollView, Animated } from 'react-native';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, Glass, GlassBtn, Press, toast, tap } from '../ui';

// экран возвращает результат через этот колбэк (навигация не умеет передавать функции надёжно)
export const EDIT = { done: null };

const COLORS = ['#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#0a84ff', '#bf5af2', '#000000'];
const SIZES = [4, 8, 14];

export default function PhotoEdit({ route, navigation }) {
  const ins = useSafeAreaInsets();
  const { width: W, height: H } = Dimensions.get('window');
  const [img, setImg] = useState({ uri: route.params.uri, w: route.params.w || 1000, h: route.params.h || 1000 });
  const [tool, setTool] = useState(null); // null | crop | draw | text
  const [paths, setPaths] = useState([]); // {d, c, s}
  const [texts, setTexts] = useState([]); // {id, t, c, x, y}
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(1);
  const [cap, setCap] = useState(route.params.cap || '');
  const [busy, setBusy] = useState(false);
  const [edText, setEdText] = useState(null);
  const shot = useRef(null);
  const cur = useRef(null);

  // область показа: фото вписано между верхней и нижней панелью
  const boxW = W, boxH = H - ins.top - ins.bottom - 220;
  const k = Math.min(boxW / img.w, boxH / img.h), vw = Math.round(img.w * k), vh = Math.round(img.h * k);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => toolRef.current === 'draw',
    onMoveShouldSetPanResponder: () => toolRef.current === 'draw',
    onPanResponderGrant: e => { const { locationX: x, locationY: y } = e.nativeEvent; cur.current = { d: `M${x.toFixed(1)} ${y.toFixed(1)}`, c: colorRef.current, s: SIZES[sizeRef.current] }; setPaths(p => [...p, cur.current]); },
    onPanResponderMove: e => { const { locationX: x, locationY: y } = e.nativeEvent; if (!cur.current) return; cur.current.d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; setPaths(p => [...p.slice(0, -1), { ...cur.current }]); },
    onPanResponderRelease: () => { cur.current = null; },
  })).current;
  const toolRef = useRef(tool); toolRef.current = tool;
  const colorRef = useRef(color); colorRef.current = color;
  const sizeRef = useRef(size); sizeRef.current = size;

  async function manip(actions) {
    if (paths.length || texts.length) { toast('Сначала кадр, потом рисунок — рисунок сброшен', 1); setPaths([]); setTexts([]); }
    setBusy(true);
    try { const r = await ImageManipulator.manipulateAsync(img.uri, actions, { compress: 1, format: ImageManipulator.SaveFormat.JPEG }); setImg({ uri: r.uri, w: r.width, h: r.height }); }
    catch (e) { toast('Не получилось', 1); }
    setBusy(false);
  }
  const aspect = (a, b) => {
    if (!a) return;
    let cw = img.w, ch = Math.round(img.w * b / a);
    if (ch > img.h) { ch = img.h; cw = Math.round(img.h * a / b); }
    manip([{ crop: { originX: Math.round((img.w - cw) / 2), originY: Math.round((img.h - ch) / 2), width: cw, height: ch } }]);
  };

  async function send() {
    setBusy(true);
    try {
      let uri = img.uri, w = img.w, h = img.h;
      if (paths.length || texts.length) {
        const outW = Math.min(1600, img.w);
        uri = await captureRef(shot, { format: 'jpg', quality: 0.9, width: outW, height: Math.round(outW * img.h / img.w) });
        w = outW; h = Math.round(outW * img.h / img.w);
      }
      const r = await ImageManipulator.manipulateAsync(uri, w > 1600 ? [{ resize: { width: 1600 } }] : [], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const done = EDIT.done; EDIT.done = null;
      navigation.goBack();
      done && done({ uri: r.uri, b64: r.base64, w: r.width, h: r.height, cap: cap.trim() });
    } catch (e) { toast('Не удалось подготовить фото', 1); setBusy(false); }
  }

  const ToolBtn = ({ ic, t, on, onPress }) => (
    <Press onPress={onPress} pop round={20} amt={0.12} style={{ alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: on ? 'rgba(47,140,255,.3)' : 'transparent' }}>
      <Ionicons name={ic} size={22} color={on ? '#7cc2ff' : '#fff'} />
      <Text style={{ color: on ? '#7cc2ff' : '#fff', fontSize: 11, marginTop: 2 }}>{t}</Text>
    </Press>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingTop: ins.top + 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <GlassBtn icon="close" onPress={() => { EDIT.done = null; navigation.goBack(); }} />
        {tool === 'draw' && paths.length > 0 ? <GlassBtn icon="arrow-undo" onPress={() => setPaths(p => p.slice(0, -1))} /> : <View />}
        {(paths.length > 0 || texts.length > 0) ? (
          <Press pop round={20} onPress={() => { setPaths([]); setTexts([]); }}><Glass round={20} style={{ paddingHorizontal: 14, height: 40, justifyContent: 'center' }}><Text style={{ color: '#fff' }}>Очистить всё</Text></Glass></Press>
        ) : <View style={{ width: 44 }} />}
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View ref={shot} collapsable={false} style={{ width: vw, height: vh }} {...pan.panHandlers}>
          <Image source={{ uri: img.uri }} style={{ width: vw, height: vh }} contentFit="fill" />
          <Svg width={vw} height={vh} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
            {paths.map((p, i) => <Path key={i} d={p.d} stroke={p.c} strokeWidth={p.s} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          </Svg>
          {texts.map(t => <DragText key={t.id} t={t} onMove={(x, y) => setTexts(L => L.map(z => (z.id === t.id ? { ...z, x, y } : z)))} onTap={() => setEdText(t)} />)}
        </View>
        {busy && <View style={{ position: 'absolute' }}><ActivityIndicator color="#fff" size="large" /></View>}
      </View>

      {/* панель инструмента */}
      {tool === 'crop' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }} style={{ flexGrow: 0, height: 52 }}>
          {[['Поворот', 'refresh', () => manip([{ rotate: 90 }])], ['Зеркало', 'swap-horizontal', () => manip([{ flip: ImageManipulator.FlipType.Horizontal }])], ['1:1', 'square-outline', () => aspect(1, 1)], ['4:3', 'tablet-landscape-outline', () => aspect(4, 3)], ['3:4', 'tablet-portrait-outline', () => aspect(3, 4)], ['16:9', 'tv-outline', () => aspect(16, 9)], ['9:16', 'phone-portrait-outline', () => aspect(9, 16)]].map(([t, ic, fn]) => (
            <Press key={t} onPress={fn} pop round={18} amt={0.1}><Glass round={18} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 38 }}><Ionicons name={ic} size={18} color="#fff" /><Text style={{ color: '#fff', marginLeft: 6 }}>{t}</Text></Glass></Press>
          ))}
        </ScrollView>
      )}
      {(tool === 'draw' || tool === 'text') && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52 }}>
          {tool === 'draw' && SIZES.map((s, i) => <Press key={s} onPress={() => setSize(i)} pop round={16} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: 4, borderRadius: 16, backgroundColor: size === i ? 'rgba(255,255,255,.18)' : 'transparent' }}><View style={{ width: s + 4, height: s + 4, borderRadius: 10, backgroundColor: color }} /></Press>)}
          {COLORS.map(c => <Press key={c} onPress={() => { setColor(c); tap(); }} pop round={14} amt={0.25} style={{ marginHorizontal: 4 }}><View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: color === c ? 3 : 1.5, borderColor: color === c ? '#fff' : 'rgba(255,255,255,.4)' }} /></Press>)}
          {tool === 'text' && <Press onPress={() => setEdText({ id: 'n' + Date.now(), t: '', c: color, x: vw / 2 - 60, y: vh / 2 - 20, nw: 1 })} pop round={18} style={{ marginLeft: 8 }}><Glass round={18} style={{ paddingHorizontal: 12, height: 36, justifyContent: 'center' }}><Text style={{ color: '#fff' }}>+ Текст</Text></Glass></Press>}
        </View>
      )}

      <View style={{ paddingHorizontal: 10, paddingBottom: Math.max(ins.bottom, 10), paddingTop: 6 }}>
        <Glass round={22} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, marginBottom: 8 }}>
          <TextInput value={cap} onChangeText={setCap} placeholder="Добавить подпись…" placeholderTextColor={C.mute} multiline style={{ color: '#fff', fontSize: 16, maxHeight: 90, paddingVertical: 8 }} selectionColor={C.blue} />
        </Glass>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Glass round={26} style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4, marginRight: 8 }}>
            <ToolBtn ic="crop" t="Кадр" on={tool === 'crop'} onPress={() => setTool(tool === 'crop' ? null : 'crop')} />
            <ToolBtn ic="brush" t="Рисунок" on={tool === 'draw'} onPress={() => setTool(tool === 'draw' ? null : 'draw')} />
            <ToolBtn ic="text" t="Текст" on={tool === 'text'} onPress={() => setTool(tool === 'text' ? null : 'text')} />
          </Glass>
          <GlassBtn icon="arrow-up" fill={C.blue} size={52} onPress={send} />
        </View>
      </View>

      {edText && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.6)', alignItems: 'center', justifyContent: 'center' }}>
          <TextInput autoFocus defaultValue={edText.t} onEndEditing={e => {
            const v = e.nativeEvent.text.trim(); const t = edText; setEdText(null);
            setTexts(L => (v ? (L.some(z => z.id === t.id) ? L.map(z => (z.id === t.id ? { ...z, t: v, c: color } : z)) : [...L, { ...t, t: v, c: color }]) : L.filter(z => z.id !== t.id)));
          }} style={{ color, fontSize: 30, fontWeight: '800', textAlign: 'center', minWidth: 200, paddingHorizontal: 20 }} placeholder="Текст" placeholderTextColor="rgba(255,255,255,.4)" multiline blurOnSubmit returnKeyType="done" />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function DragText({ t, onMove, onTap }) {
  const pos = useRef(new Animated.ValueXY({ x: t.x, y: t.y })).current;
  const st = useRef({ x: t.x, y: t.y, moved: false });
  const pr = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { st.current.moved = false; },
    onPanResponderMove: (_, g) => { if (Math.abs(g.dx) + Math.abs(g.dy) > 4) st.current.moved = true; pos.setValue({ x: st.current.x + g.dx, y: st.current.y + g.dy }); },
    onPanResponderRelease: (_, g) => { if (!st.current.moved) return onTap(); st.current.x += g.dx; st.current.y += g.dy; onMove(st.current.x, st.current.y); },
  })).current;
  return (
    <Animated.View {...pr.panHandlers} style={{ position: 'absolute', left: 0, top: 0, transform: pos.getTranslateTransform() }}>
      <Text style={{ color: t.c, fontSize: 30, fontWeight: '800', textShadowColor: 'rgba(0,0,0,.5)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}>{t.t}</Text>
    </Animated.View>
  );
}
