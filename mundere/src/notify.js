// Уведомления о новых сообщениях. Пока приложение открыто или свёрнуто недавно — показываем их сами
// (локально). Для пушей при полностью закрытом приложении нужен Firebase — подключается отдельно.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createNavigationContainerRef } from '@react-navigation/native';

export const nav = createNavigationContainerRef();
let ready = false;

export async function initNotify() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowAlert: true }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('msgs', { name: 'Сообщения', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 120, 80, 120], lightColor: '#8b5cf6' });
    }
    const st = await Notifications.getPermissionsAsync();
    ready = st.granted || (await Notifications.requestPermissionsAsync()).granted;
    Notifications.addNotificationResponseReceivedListener(r => {
      const d = r.notification.request.content.data || {};
      if (d.c && nav.isReady()) nav.navigate('Chat', d.peer ? { c: d.c, peer: d.peer } : { c: d.c });
    });
  } catch (e) {}
}

export function notify(title, body, data) {
  if (!ready) return;
  Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: 'default' }, trigger: Platform.OS === 'android' ? { channelId: 'msgs' } : null }).catch(() => {});
}
