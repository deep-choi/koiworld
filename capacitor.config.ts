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
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'playgames.google.com'],
    },
  },
};

export default config;
