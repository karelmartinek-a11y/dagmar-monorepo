plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "cz.hcasc.dagmar.core.data"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
}

dependencies {
    implementation(androidLibs.hilt.android)
    kapt(androidLibs.hilt.compiler)

    implementation(project(":core:network"))
    implementation(project(":core:common"))
    implementation(project(":core:auth"))
    implementation(androidLibs.coroutines.core)
    implementation(androidLibs.serialization.json)
    implementation(androidLibs.datastore.preferences)
}
