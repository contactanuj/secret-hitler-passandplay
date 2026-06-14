import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  View,
  Platform,
  StatusBar as RNStatusBar,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';

export default function App() {
  const [html, setHtml] = useState(null);

  useEffect(() => {
    (async () => {
      const asset = Asset.fromModule(require('./assets/app.html'));
      await asset.downloadAsync();
      const content = await FileSystem.readAsStringAsync(asset.localUri);
      setHtml(content);
    })();
  }, []);

  // SafeAreaView insets the notch/home-indicator on iOS; on Android it is a no-op,
  // so we add the status-bar height as top padding there. This keeps the WebView
  // content from sliding under the system status bar.
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#0f0d0b" />
      {html && (
        <WebView
          style={styles.webview}
          source={{ html }}
          originWhitelist={['*']}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={true}
          mixedContentMode="always"
          scrollEnabled={true}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0d0b',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0f0d0b',
  },
});
