import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StatusBar as RNSB } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSession, dropSession } from './api';
import { start } from './store';
import { BubbleHost, ToastHost, C } from './ui';
import Login from './screens/Login';
import Home from './screens/Home';
import Chat from './screens/Chat';
import Profile from './screens/Profile';
import GroupInfo from './screens/GroupInfo';
import NewGroup from './screens/NewGroup';
import Viewer from './screens/Viewer';

const Stack = createNativeStackNavigator();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#000', card: '#000', primary: C.blue } };

export default function App() {
  const [st, setSt] = useState('boot'); // boot | auth | app
  useEffect(() => {
    SystemUI.setBackgroundColorAsync('#000').catch(() => {});
    (async () => {
      const has = await loadSession();
      if (!has) return setSt('auth');
      try { await start(); setSt('app'); }
      catch (e) { if (e.status === 401 || e.status === 403) { await dropSession(); setSt('auth'); } else { setSt('app'); setTimeout(() => start().catch(() => {}), 3000); } }
    })();
  }, []);
  const onLogin = async () => { await start(); setSt('app'); };
  const onLogout = async () => { await dropSession(); setSt('auth'); };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {st === 'boot' ? (
        <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.violet} /></View>
      ) : st === 'auth' ? (
        <Login onDone={onLogin} />
      ) : (
        <NavigationContainer theme={theme}>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#000' }, gestureEnabled: true, fullScreenGestureEnabled: true }}>
            <Stack.Screen name="Home">{p => <Home {...p} onLogout={onLogout} />}</Stack.Screen>
            <Stack.Screen name="Chat" component={Chat} />
            <Stack.Screen name="Profile" component={Profile} />
            <Stack.Screen name="GroupInfo" component={GroupInfo} />
            <Stack.Screen name="NewGroup" component={NewGroup} options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
            <Stack.Screen name="Viewer" component={Viewer} options={{ animation: 'fade', presentation: 'transparentModal' }} />
          </Stack.Navigator>
        </NavigationContainer>
      )}
      <BubbleHost />
      <ToastHost />
    </SafeAreaProvider>
  );
}
