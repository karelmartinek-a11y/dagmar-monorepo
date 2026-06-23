plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "cz.hcasc.dagmar.feature.adminsettings"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
    buildFeatures { compose = true }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.0"
    }
}

dependencies {
    implementation(androidLibs.compose.ui)
    implementation(androidLibs.compose.material)
    implementation(androidLibs.hilt.android)
    implementation(androidLibs.hilt.navigation.compose)
    kapt(androidLibs.hilt.compiler)
    implementation(project(":core:network"))
    implementation(project(":core:designsystem"))
}
