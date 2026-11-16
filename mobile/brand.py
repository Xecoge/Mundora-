# Иконка, заставка и тёмные цвета Mundora для сгенерированных проектов Android и iOS.
# Запуск: python3 brand.py android|ios  (из папки mobile)
import os, re, sys
from PIL import Image, ImageDraw
plat = sys.argv[1]
root = plat
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
icon = Image.open(os.path.join(A, 'icon.png')).convert('RGBA')
fg = Image.open(os.path.join(A, 'foreground.png')).convert('RGBA')
spl = Image.open(os.path.join(A, 'splash.png')).convert('RGB')
BG = '#0E0A18'

def cover(im, w, h):
    r = max(w / im.width, h / im.height)
    im2 = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
    l, t = (im2.width - w) // 2, (im2.height - h) // 2
    return im2.crop((l, t, l + w, t + h))

n = 0
for dp, _, fs in os.walk(root):
    if 'build' in dp.split(os.sep) or 'node_modules' in dp: continue
    for f in fs:
        if not f.lower().endswith('.png'): continue
        p = os.path.join(dp, f); low = (dp + '/' + f).lower()
        try: w, h = Image.open(p).size
        except Exception: continue
        if 'splash' in low:
            out = cover(spl, w, h)
        elif 'foreground' in f.lower():
            out = fg.resize((w, h), Image.LANCZOS)
        elif 'ic_launcher' in f.lower() or 'appicon' in low:
            out = icon.resize((w, h), Image.LANCZOS)
            if 'round' in f.lower():
                m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).ellipse((0, 0, w - 1, h - 1), fill=255)
                o = Image.new('RGBA', (w, h), (0, 0, 0, 0)); o.paste(out, (0, 0), m); out = o
            if plat == 'ios': out = out.convert('RGB')
        else:
            continue
        out.save(p); n += 1
print('images replaced:', n)

if plat == 'android':
    res = os.path.join(root, 'app', 'src', 'main', 'res')
    def edit(path, fn):
        if not os.path.exists(path): print('нет файла', path); return
        s = open(path, encoding='utf-8').read(); s2 = fn(s)
        open(path, 'w', encoding='utf-8').write(s2)
    edit(os.path.join(res, 'values', 'ic_launcher_background.xml'), lambda s: re.sub(r'#[0-9A-Fa-f]{6,8}', BG, s))
    def colors(s):
        s = re.sub(r'(<color name="colorPrimary(?:Dark)?">)[^<]*', r'\g<1>' + BG, s)
        s = re.sub(r'(<color name="colorAccent">)[^<]*', r'\g<1>#8B5CF6', s)
        if 'mundoraBg' not in s: s = s.replace('</resources>', f'    <color name="mundoraBg">{BG}</color>\n</resources>')
        return s
    cx = os.path.join(res, 'values', 'colors.xml')
    if not os.path.exists(cx):
        open(cx, 'w', encoding='utf-8').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n')
    edit(cx, colors)
    def styles(s):
        add = ('<item name="android:windowBackground">@color/mundoraBg</item>'
               '<item name="android:statusBarColor">@color/mundoraBg</item>'
               '<item name="android:navigationBarColor">@color/mundoraBg</item>'
               '<item name="android:windowLightStatusBar">false</item>'
               '<item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>')
        s = re.sub(r'(<style name="AppTheme\.NoActionBar"[^>]*>)', r'\1' + add, s)
        s = re.sub(r'(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)', r'\1<item name="windowSplashScreenBackground">@color/mundoraBg</item>', s)
        return s
    edit(os.path.join(res, 'values', 'styles.xml'), styles)
    # камера и микрофон для голосовых и видеокружков (Capacitor сам спросит разрешение, когда сайт попросит)
    def perms(x):
        add = ''.join(f'    <uses-permission android:name="android.permission.{p}" />\n' for p in ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'CAMERA'] if f'permission.{p}"' not in x)
        add += '' if 'android.hardware.camera' in x else '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
        return x.replace('</manifest>', add + '</manifest>')
    edit(os.path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml'), perms)
    # версия = номер сборки
    run = os.environ.get('GITHUB_RUN_NUMBER', '1')
    edit(os.path.join(root, 'app', 'build.gradle'), lambda s: re.sub(r'versionName "[^"]*"', f'versionName "1.0.{run}"', re.sub(r'versionCode \d+', f'versionCode {run}', s)))
    # музыка в фоне: не ставим WebView на паузу, когда приложение свёрнуто
    ma = os.path.join(root, 'app', 'src', 'main', 'java', 'app', 'mundora', 'MainActivity.java')
    if os.path.exists(ma):
        open(ma, 'w', encoding='utf-8').write('''package app.mundora;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // скачивание файлов из чатов в «Загрузки» телефона
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null) r.addRequestHeader("cookie", cookie);
                    r.addRequestHeader("User-Agent", userAgent);
                    String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    r.setTitle(name);
                    r.setMimeType(mimeType);
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                    Toast.makeText(this, "Скачивается: " + name, Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Не удалось скачать", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // музыка в фоне: не ставим WebView на паузу, когда приложение свёрнуто
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }
}
''')
        print('MainActivity: фоновое воспроизведение')
    print('android: цвета, тема и версия 1.0.' + run)
