plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "cz.hcasc.dagmar.core.network"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
    }
}

dependencies {
    implementation(androidLibs.hilt.android)
    kapt(androidLibs.hilt.compiler)

    implementation(project(":core:common"))
    implementation(project(":core:auth"))
    implementation(androidLibs.retrofit)
    implementation(androidLibs.retrofit.kotlinx.serialization)
    implementation(androidLibs.okhttp)
    implementation(androidLibs.okhttp.logging)
    implementation(androidLibs.serialization.json)
}
