plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "cz.hcasc.dagmar.core.common"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
    }
}

dependencies {
    implementation(androidLibs.kotlin.stdlib)
    implementation(androidLibs.coroutines.core)
    implementation(androidLibs.serialization.json)
    implementation(androidLibs.log.timber)
}
