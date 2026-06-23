plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "cz.hcasc.dagmar.core.auth"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
}

dependencies {
    implementation(androidLibs.hilt.android)
    kapt(androidLibs.hilt.compiler)

    implementation(project(":core:common"))
    implementation(androidLibs.datastore.preferences)
    implementation(androidLibs.coroutines.core)
}
