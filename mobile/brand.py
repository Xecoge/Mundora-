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
        add = ''.join(f'    <uses-permission android:name="android.permission.{p}" />\n' for p in ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'WAKE_LOCK', 'CAMERA', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'READ_MEDIA_VISUAL_USER_SELECTED', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'] if f'permission.{p}"' not in x)
        add += '' if 'READ_EXTERNAL_STORAGE' in x else '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n'
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
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.InputStream;
import android.Manifest;
import android.webkit.GeolocationPermissions;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.os.PowerManager;
import com.getcapacitor.BridgeWebChromeClient;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.util.Size;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
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
            bridge.getWebView().addJavascriptInterface(new SaveBridge(), "MundoraNative");
            bridge.getWebView().addJavascriptInterface(new MediaBridge(), "MundoraMedia");
            bridge.getWebView().addJavascriptInterface(new CallBridge(), "MundoraCall");
            // геопозиция: если доступ уже дан — не спрашивать снова
            bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                    if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) { callback.invoke(origin, true, true); return; }
                    super.onGeolocationPermissionsShowPrompt(origin, callback);
                }
            });
        }
    }

    // галерея и музыка телефона прямо в шторке «скрепки», как в Telegram
    private String[] mediaPerms() {
        if (Build.VERSION.SDK_INT >= 33) return new String[]{Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO};
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }
    private boolean has(String p) { return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED; }
    private void js(String code) { runOnUiThread(() -> { if (bridge != null && bridge.getWebView() != null) bridge.getWebView().evaluateJavascript(code, null); }); }
    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == 7701) js("window.__mdPerm&&window.__mdPerm()");
    }
    public class MediaBridge {
        @JavascriptInterface
        public String perm() {
            String media; boolean aud;
            if (Build.VERSION.SDK_INT >= 33) {
                boolean img = has(Manifest.permission.READ_MEDIA_IMAGES), vid = has(Manifest.permission.READ_MEDIA_VIDEO);
                boolean part = Build.VERSION.SDK_INT >= 34 && has("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
                media = img || vid ? "all" : part ? "some" : "no"; aud = has(Manifest.permission.READ_MEDIA_AUDIO);
            } else { boolean r = has(Manifest.permission.READ_EXTERNAL_STORAGE); media = r ? "all" : "no"; aud = r; }
            try { JSONObject o = new JSONObject(); o.put("media", media); o.put("audio", aud); return o.toString(); } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface
        public void ask() { runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this, mediaPerms(), 7701)); }
        private Uri uriOf(String k, long id) {
            Uri base = k.equals("v") ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : k.equals("a") ? MediaStore.Audio.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            return ContentUris.withAppendedId(base, id);
        }
        @JavascriptInterface
        public String list(String kind, int offset, int limit) {
            JSONArray out = new JSONArray();
            try {
                Cursor c;
                if (kind.equals("audio")) {
                    c = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, new String[]{MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.MIME_TYPE, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST},
                        null, null, MediaStore.Audio.Media.DATE_ADDED + " DESC");
                } else {
                    c = getContentResolver().query(MediaStore.Files.getContentUri("external"), new String[]{MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.MIME_TYPE, MediaStore.Files.FileColumns.SIZE, MediaStore.Files.FileColumns.DATE_ADDED, MediaStore.Files.FileColumns.MEDIA_TYPE},
                        MediaStore.Files.FileColumns.MEDIA_TYPE + " IN (" + MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE + "," + MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO + ")", null, MediaStore.Files.FileColumns.DATE_ADDED + " DESC");
                }
                if (c == null) return "[]";
                int i = 0;
                while (c.moveToNext()) {
                    if (i++ < offset) continue;
                    if (out.length() >= limit) break;
                    JSONObject o = new JSONObject();
                    o.put("id", c.getLong(0)); o.put("n", c.getString(1)); o.put("ty", c.getString(2)); o.put("sz", c.getLong(3)); o.put("t", c.getLong(4));
                    if (kind.equals("audio")) { o.put("k", "a"); o.put("d", c.getLong(5) / 1000); o.put("title", c.getString(6)); o.put("artist", c.getString(7)); }
                    else o.put("k", c.getInt(5) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO ? "v" : "i");
                    out.put(o);
                }
                c.close();
            } catch (Exception e) { return "[]"; }
            return out.toString();
        }
        // обложки отдаются по одной, не блокируя страницу
        @JavascriptInterface
        public void thumbs(String keys) {
            new Thread(() -> {
                for (String key : keys.split(",")) {
                    try {
                        String[] kv = key.split(":"); String k = kv[0]; long id = Long.parseLong(kv[1]);
                        Bitmap b;
                        if (Build.VERSION.SDK_INT >= 29) b = getContentResolver().loadThumbnail(uriOf(k, id), new Size(320, 320), null);
                        else if (k.equals("v")) b = MediaStore.Video.Thumbnails.getThumbnail(getContentResolver(), id, MediaStore.Video.Thumbnails.MINI_KIND, null);
                        else b = MediaStore.Images.Thumbnails.getThumbnail(getContentResolver(), id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                        if (b == null) continue;
                        ByteArrayOutputStream bo = new ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.JPEG, 72, bo);
                        js("window.__mdThumb&&window.__mdThumb('" + key + "','data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP) + "')");
                    } catch (Exception e) { }
                }
            }).start();
        }
        // сам файл — кусками в страницу
        @JavascriptInterface
        public void read(String req, String key) {
            new Thread(() -> {
                try {
                    String[] kv = key.split(":");
                    InputStream in = getContentResolver().openInputStream(uriOf(kv[0], Long.parseLong(kv[1])));
                    byte[] buf = new byte[393216]; int n, part = 0;
                    ByteArrayOutputStream acc = new ByteArrayOutputStream();
                    while ((n = in.read(buf)) > 0) {
                        acc.write(buf, 0, n);
                        if (acc.size() >= 393216) { js("window.__mdChunk&&window.__mdChunk('" + req + "'," + (part++) + ",'" + Base64.encodeToString(acc.toByteArray(), Base64.NO_WRAP) + "',0)"); acc.reset(); }
                    }
                    in.close();
                    js("window.__mdChunk&&window.__mdChunk('" + req + "'," + part + ",'" + Base64.encodeToString(acc.toByteArray(), Base64.NO_WRAP) + "',1)");
                } catch (Exception e) { js("window.__mdChunk&&window.__mdChunk('" + req + "',-1,'',1)"); }
            }).start();
        }
    }

    // сохранить видео/фото, собранное на странице (кружок в рамке), прямо в галерею
    // звонки: разговорный динамик (у уха) по умолчанию, громкая связь по кнопке, датчик приближения гасит экран у уха
    private PowerManager.WakeLock proxLock;
    private void prox(boolean on) {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (on) { if (proxLock == null) proxLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "mundora:prox"); if (!proxLock.isHeld()) proxLock.acquire(3 * 60 * 60 * 1000L); }
            else if (proxLock != null && proxLock.isHeld()) proxLock.release();
        } catch (Exception e) { }
    }
    private void route(AudioManager am, boolean speaker) {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                int want = speaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
                for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) if (d.getType() == want) { am.setCommunicationDevice(d); return; }
                if (!speaker) am.clearCommunicationDevice();
            } else am.setSpeakerphoneOn(speaker);
        } catch (Exception e) { }
    }
    public class CallBridge {
        @JavascriptInterface public void start(boolean speaker) { runOnUiThread(() -> { AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE); am.setMode(AudioManager.MODE_IN_COMMUNICATION); route(am, speaker); prox(!speaker); }); }
        @JavascriptInterface public void speaker(boolean on) { runOnUiThread(() -> { AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE); route(am, on); prox(!on); }); }
        @JavascriptInterface public void stop() { runOnUiThread(() -> { AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE); route(am, false); if (Build.VERSION.SDK_INT >= 31) { try { am.clearCommunicationDevice(); } catch (Exception e) { } } am.setMode(AudioManager.MODE_NORMAL); prox(false); }); }
    }

    public class SaveBridge {
        @JavascriptInterface
        public boolean saveMedia(String name, String mime, String b64) {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                boolean vid = mime != null && mime.startsWith("video");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, (vid ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Mundora");
                    Uri col = vid ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                    Uri u = getContentResolver().insert(col, v);
                    if (u == null) return false;
                    OutputStream o = getContentResolver().openOutputStream(u);
                    o.write(data); o.close();
                } else {
                    File d = new File(Environment.getExternalStoragePublicDirectory(vid ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), "Mundora");
                    d.mkdirs();
                    File f = new File(d, name);
                    FileOutputStream o = new FileOutputStream(f);
                    o.write(data); o.close();
                    MediaScannerConnection.scanFile(MainActivity.this, new String[]{f.getAbsolutePath()}, null, null);
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Сохранено в галерею", Toast.LENGTH_SHORT).show());
                return true;
            } catch (Exception e) {
                return false;
            }
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
