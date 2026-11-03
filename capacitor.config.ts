/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zenkoigarden.game',
  appName: 'Koiworld',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 150,
      showSpinner: false,
    },
    // 결제는 서버(verifyPlayPurchase)가 확인한 뒤에만 승인/소비합니다. 플러그인의 자동 마무리를 끕니다.
    NativePurchases: {
      autoFinishTransactions: false,
    },
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'playgames.google.com'],
    },
  },
};

export default config;
