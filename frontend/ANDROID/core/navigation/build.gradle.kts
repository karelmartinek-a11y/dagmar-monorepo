plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cz.hcasc.dagmar.core.navigation"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
}

dependencies {
    implementation(androidLibs.navigation.compose)
    implementation(project(":core:domain"))
    implementation(project(":feature:employee-auth"))
    implementation(project(":feature:employee-attendance"))
    implementation(project(":feature:password-reset"))
}
