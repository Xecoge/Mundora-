// Профиль человека — как на сайте: стеклянная полоса «Профиль» сверху и карточка ProfileView.
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cidOf } from '../store';
import { M } from '../api';
import { Glass, Press } from '../ui';
import ProfileView from '../ProfileView';

export function TopBar({ title, onBack, right, onRight }) {
  const ins = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', top: ins.top + 8, left: 10, right: 10 }}>
      <Glass round={24} style={{ height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <Press onPress={onBack} pop round={19} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="chevron-back" size={22} color="#fff" /></Press>
        <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '700' }}>{title}</Text>
        {right ? <Press onPress={onRight} pop round={19} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={right} size={21} color="#fff" /></Press> : <View style={{ width: 38 }} />}
      </Glass>
    </View>
  );
}

export default function Profile({ route, navigation }) {
  const id = String(route.params.id), own = id === String(M.me);
  return (
    <View style={{ flex: 1, backgroundColor: '#0d0819' }}>
      <ProfileView id={id} own={own} navigation={navigation} />
      <TopBar title="Профиль" onBack={() => navigation.goBack()} right={own ? null : 'chatbubble-ellipses-outline'} onRight={() => navigation.navigate('Chat', { c: cidOf(id), peer: id })} />
    </View>
  );
}
