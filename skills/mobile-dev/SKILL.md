# Skill: Mobile App Development

## Scope
Wrapping web apps as native mobile apps using Capacitor (or alternatives).

## Capacitor Workflow
1. Ensure web app has responsive design
2. Install Capacitor:
   ```bash
   npm install @capacitor/core @capacitor/cli
   npx cap init <AppName> <com.namibarden.appname>
   ```
3. Add platforms:
   ```bash
   npx cap add android
   npx cap add ios
   ```
4. Build web app → copy to native:
   ```bash
   npm run build
   npx cap copy
   npx cap sync
   ```
5. Open in native IDE:
   ```bash
   npx cap open android   # Android Studio
   npx cap open ios        # Xcode (macOS only)
   ```

## Android Build (Server-Side)
- Android SDK can be installed on server for CI builds
- Use `gradle assembleRelease` for APK
- Sign with keystore for Play Store

## iOS Build
- Requires macOS + Xcode (not available on this server)
- Options: Mac cloud service, or build locally on Gil's machine

## Key Plugins
- @capacitor/splash-screen — App launch screen
- @capacitor/status-bar — Status bar customization
- @capacitor/push-notifications — Push notifications
- @capacitor/camera — Camera access
- @capacitor/geolocation — GPS

## Alternatives to Capacitor
- **TWA (Trusted Web Activity)** — Android-only, wraps PWA
- **PWA** — Progressive Web App, no native wrapper needed
- **Expo/React Native** — Full native if more control needed

## Current Target
BeastMode workout app → Android APK via Capacitor
