// Изменить свой профиль: аватарка (галерея/камера), имя, о себе. Те же данные, что на сайте.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, KeyboardAvoidingView, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { S, loadPeers } from '../store';
import { M, req, people } from '../api';
import { C, GlassBtn, Press, Avatar, bubble, toast } from '../ui';

export default function EditMe({ navigation }) {
  const ins = useSafeAreaInsets();
  const p = S.peers[M.me] || {};
  const [name, setName] = useState(p.name || '');
  const [bio, setBio] = useState('');
  const [ava, setAva] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { people('id=' + M.me).then(j => { const u = j.profile || j.user || j; if (u && u.bio != null) setBio(u.bio); if (u && u.name) setName(u.name); }).catch(() => {}); }, []);

  async function pick(cam) {
    const pr = cam ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!pr.granted) return toast('Нет доступа', 1);
    const opt = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
    const r = cam ? await ImagePicker.launchCameraAsync(opt) : await ImagePicker.launchImageLibraryAsync(opt);
    if (r.canceled) return;
    const m = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 400, height: 400 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    setAva('data:image/jpeg;base64,' + m.base64);
  }
  async function save() {
    setBusy(true);
    try {
      if (ava) await req('/api/people?a=avatar', { data: ava });
      await req('/api/people?a=me', { name: name.trim(), bio: bio.trim() });
      await loadPeers([String(M.me)], true);
      toast('Профиль сохранён'); navigation.goBack();
    } catch (e) { toast(e.message, 1); }
    setBusy(false);
  }
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingTop: ins.top + 6, paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
        <GlassBtn icon="close" onPress={() => navigation.goBack()} />
        {busy ? <ActivityIndicator color="#fff" style={{ marginRight: 12 }} /> : <GlassBtn icon="checkmark" fill={C.blue} onPress={save} />}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Press pop round={55} amt={0.07} onPress={e => bubble({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, [{ t: 'Выбрать из галереи', ic: 'images-outline', fn: () => pick(0) }, { t: 'Сделать фото', ic: 'camera-outline', fn: () => pick(1) }])} style={{ alignSelf: 'center', alignItems: 'center' }}>
          {ava ? <Image source={{ uri: ava }} style={{ width: 110, height: 110, borderRadius: 55 }} /> : <Avatar p={p} size={110} />}
          <View style={{ position: 'absolute', right: 0, bottom: 22, width: 34, height: 34, borderRadius: 17, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#000' }}><Ionicons name="camera" size={16} color="#fff" /></View>
          <Text style={{ color: C.blue, fontSize: 15, marginTop: 8 }}>Изменить фото</Text>
        </Press>
        <View style={{ backgroundColor: C.card, borderRadius: 18, marginTop: 22, overflow: 'hidden' }}>
          <TextInput value={name} onChangeText={setName} placeholder="Имя (ник)" placeholderTextColor={C.mute} maxLength={32} style={{ color: '#fff', fontSize: 17, height: 52, paddingHorizontal: 16 }} selectionColor={C.blue} />
          <View style={{ height: 1, backgroundColor: C.line, marginLeft: 16 }} />
          <TextInput value={bio} onChangeText={setBio} placeholder="О себе" placeholderTextColor={C.mute} maxLength={200} multiline style={{ color: '#fff', fontSize: 17, minHeight: 80, paddingHorizontal: 16, paddingVertical: 14 }} selectionColor={C.blue} />
        </View>
        <Text style={{ color: C.mute, fontSize: 13, marginTop: 10, marginHorizontal: 6 }}>Имя и аватарку видят все в Mundere и Mundora. ID {M.me}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
