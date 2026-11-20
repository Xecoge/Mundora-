// Просмотр фото на весь экран: тянешь вниз — закрывается, как в Telegram.
import React, { useRef } from 'react';
import { View, Animated, PanResponder, Dimensions, Text } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { authed } from '../api';
import { GlassBtn } from '../ui';

export default function Viewer({ route, navigation }) {
  const { uri, w, h, plain, name } = route.params, ins = useSafeAreaInsets();
  const { width: W, height: H } = Dimensions.get('window');
  const y = useRef(new Animated.Value(0)).current;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: Animated.event([null, { dy: y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dy) > 120 || Math.abs(g.vy) > 1.2) Animated.timing(y, { toValue: g.dy > 0 ? H : -H, duration: 180, useNativeDriver: false }).start(() => navigation.goBack());
      else Animated.spring(y, { toValue: 0, useNativeDriver: false, bounciness: 8 }).start();
    },
  })).current;
  const ar = w && h ? h / w : 1;
  const iw = W, ih = Math.min(H * 0.85, W * ar);
  const bg = y.interpolate({ inputRange: [-400, 0, 400], outputRange: ['rgba(0,0,0,0.2)', 'rgba(0,0,0,1)', 'rgba(0,0,0,0.2)'] });
  const sc = y.interpolate({ inputRange: [-400, 0, 400], outputRange: [0.8, 1, 0.8], extrapolate: 'clamp' });
  return (
    <Animated.View style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }} {...pan.panHandlers}>
      <Animated.View style={{ transform: [{ translateY: y }, { scale: sc }] }}>
        {route.params.video ? <Vid uri={uri} w={iw} h={Math.min(H * 0.85, W * (w && h ? h / w : 16 / 9))} /> : <Image source={plain ? { uri } : authed(uri)} style={{ width: iw, height: ih }} contentFit="contain" transition={150} />}
      </Animated.View>
      <View style={{ position: 'absolute', top: ins.top + 4, left: 8, right: 8, flexDirection: 'row', alignItems: 'center' }}>
        <GlassBtn icon="close" onPress={() => navigation.goBack()} />
        {!!name && <Text numberOfLines={1} style={{ color: '#fff', marginLeft: 12, flex: 1 }}>{name}</Text>}
      </View>
    </Animated.View>
  );
}

// видео: системный плеер (кнопки, перемотка, полный экран, картинка-в-картинке)
function Vid({ uri, w, h }) {
  const player = useVideoPlayer(authed(uri), p => { p.loop = false; p.play(); });
  return <VideoView player={player} style={{ width: w, height: h }} nativeControls contentFit="contain" allowsFullscreen allowsPictureInPicture />;
}
