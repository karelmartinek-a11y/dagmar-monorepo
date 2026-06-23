plugins {
    alias(androidLibs.plugins.android.library)
    alias(androidLibs.plugins.kotlin.android)
    alias(androidLibs.plugins.serial)
}

android {
    namespace = "cz.hcasc.dagmar.core.domain"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
}

dependencies {
    implementation(project(":core:common"))
    implementation(androidLibs.coroutines.core)
    implementation(androidLibs.serialization.json)
}
