plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cz.hcasc.dagmar.core.files"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
}

dependencies {
    implementation(project(":core:common"))
    implementation(androidLibs.coroutines.core)
    implementation(androidLibs.coroutines.android)
}
