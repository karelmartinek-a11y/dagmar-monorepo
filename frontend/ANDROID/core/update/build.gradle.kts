plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "cz.hcasc.dagmar.core.update"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
}

dependencies {
    implementation(androidLibs.hilt.android)
    kapt(androidLibs.hilt.compiler)

    implementation(project(":core:common"))
    implementation(androidLibs.play.core)
    implementation(androidLibs.coroutines.core)
    implementation(androidLibs.serialization.json)
    implementation(androidLibs.okhttp)
}
