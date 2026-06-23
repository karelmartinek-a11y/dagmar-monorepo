plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "cz.hcasc.dagmar"
    compileSdk = 35

    defaultConfig {
        applicationId = "cz.hcasc.dagmar"
        minSdk = 26
        targetSdk = 35
        versionCode = 100
        versionName = "1.0.0"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
            resValue("string", "distribution_label", "Play")
            versionNameSuffix = "-play"
        }
        create("direct") {
            dimension = "distribution"
            resValue("string", "distribution_label", "Direct")
            versionNameSuffix = "-direct"
        }
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.0"
    }

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
        }
    }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:designsystem"))
    implementation(project(":core:network"))
    implementation(project(":core:data"))
    implementation(project(":core:domain"))
    implementation(project(":core:navigation"))
    implementation(project(":core:auth"))
    implementation(project(":core:files"))
    implementation(project(":core:update"))
    implementation(project(":feature:employee-auth"))
    implementation(project(":feature:employee-attendance"))
    implementation(project(":feature:password-reset"))
    implementation(project(":feature:admin-auth"))
    implementation(project(":feature:admin-users"))
    implementation(project(":feature:admin-attendance"))
    implementation(project(":feature:admin-shift-plan"))
    implementation(project(":feature:admin-export"))
    implementation(project(":feature:admin-prints"))
    implementation(project(":feature:admin-settings"))
    implementation(project(":feature:about"))

    implementation(androidLibs.compose.ui)
    implementation(androidLibs.compose.material)
    implementation(androidLibs.activity.compose)
    implementation(androidLibs.navigation.compose)
    implementation(androidLibs.hilt.android)
    implementation(androidLibs.hilt.navigation.compose)
    implementation(androidLibs.coroutines.android)
    implementation(androidLibs.coroutines.core)
    implementation(androidLibs.retrofit)
    implementation(androidLibs.retrofit.kotlinx.serialization)
    implementation(androidLibs.okhttp)
    implementation(androidLibs.okhttp.logging)
    implementation(androidLibs.serialization.json)
    implementation(androidLibs.datastore.preferences)
    implementation(androidLibs.play.core)

    kapt(androidLibs.hilt.compiler)
}
