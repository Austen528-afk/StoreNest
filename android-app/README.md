# StoreNest Android app

A standalone **Android application package (APK)** for StoreNest. Unlike a Chrome home-screen bookmark, the APK installs a real entry named **StoreNest** in the Android app drawer and system app settings, with its own launcher icon and no browser address bar.

## Status

Preview build: securely loads `https://storenest-eight.vercel.app/` inside an Android WebView. StoreNest storefront registration, accounts, payments and orders are still being developed.

## Build (Android Studio or CLI)

Requires JDK 17, Android SDK 35 and Gradle 8.11.1.

1. Open `android-app/` in Android Studio and sync Gradle.
2. Build → Build APK(s), or execute `gradle :app:assembleDebug`.
3. Install `app/build/outputs/apk/debug/app-debug.apk` on your Samsung phone.

The GitHub workflow `Build StoreNest Android APK` produces a downloadable ZIP containing the **debug APK**. This APK is for testing only; it is not a signed Play Store release. Android may ask for permission to install apps from the download source. Install only builds you trust.

## Security

- Network access uses HTTPS; cleartext traffic is disabled.
- Only StoreNest pages stay inside the app; other web links open in the system browser.
- No embedded API keys, private tokens, payment details or passwords are stored in source.
- Production distribution requires your controlled release signing key and app store checks.

## Next

For future versions we can adopt Capacitor to add native features while keeping the same StoreNest website and iOS PWA.
