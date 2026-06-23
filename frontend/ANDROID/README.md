# KájovoDagmar Android (work-in-progress)

## Overview
- Kotlin + Jetpack Compose multi-module structure mirroring the web modules (core/auth, feature/employee, feature/admin, core/network, core/update, core/files, etc.).
- Hilt, Retrofit/OkHttp, Kotlinx Serialization, and Coroutines/Flow power the data layer.
- The navigation graph currently wires only the employee auth/attendance/reset flows; admin screens are yet to be implemented.

## Setup
1. Install the Android SDK (including platforms;android-34 and build-tools;34.0.0) and accept the licenses (sdkmanager --install 'platforms;android-34' 'build-tools;34.0.0' and sdkmanager --licenses).
2. Point ANDROID/local.properties sdk.dir at the SDK (e.g., C:\Users\provo\AppData\Local\Android\Sdk).
3. The project assumes Kotlin 1.9.10, Hilt 2.46, Compose 1.3.1, and flavors for Play vs. Direct.
4. Gradle currently runs on the system JDK (Java 21). Kotlin kapt fails with IllegalAccessError when the compiler cannot access com.sun.tools.javac.main. Add org.gradle.jvmargs=--add-exports=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED (and other exports if required) or target JDK 17 until the kapt issue is resolved.

## Build & tests
- Frontend: npm ci, npm run build, npm run lint (all succeed, npm run build emits the dist/ directory).
- Backend: python -m pytest (six smoke tests under ../dagmar-backend).
- Android: ./gradlew.bat clean succeeds; assemblePlayDebug, assembleDirectDebug, test, and lint currently fail because Kotlin kapt cannot access com.sun.tools.javac.main when running on Java 21 (see the IllegalAccessError logged by Gradle). Addressing the module export issue is required before APK/AAB artifacts can be produced.

## Flavors
- The play flavor uses Play Core for in-app updates (PlayUpdateManager).
- The direct flavor downloads metadata from the planned /android-update.json endpoint (see core/update) and installs APKs itself once the backend contract exists.

## Deep links
- /app, /reset?token=..., /admin/login, /admin/users, /admin/dochazka, /admin/plan-sluzeb, /admin/export, /admin/tisky, and /admin/settings are the planned deep links; only /app+/reset are wired today.

## Update flow
- Play flavor checks Play Store availability via AppUpdateManager.
- Direct flavor hits the metadata URL and downloads the APK, verifying the checksum once that endpoint exists (see ANDROID/docs/08_UPDATE_DISTRIBUTION_SPEC.md).

## Known issues
- Admin features (users, attendance, shift plan, export, prints, settings) still need Compose UIs, ViewModels, and data plumbing.
- Android builds cannot complete under Java 21 without extra --add-exports flags or downgrading to Java 17 because kapt cannot access com.sun.tools.javac.main.

## Artefacts
- Frontend: dist/ (produced by npm run build).
- Android APKs are not yet produced because the Gradle build fails; see the module export blocker above.
