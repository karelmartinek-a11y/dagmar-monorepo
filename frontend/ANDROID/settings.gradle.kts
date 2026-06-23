pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }

    plugins {
        id("com.android.application") version "8.6.0" apply false
        id("com.android.library") version "8.6.0" apply false
        id("org.jetbrains.kotlin.android") version "1.9.0" apply false
        id("org.jetbrains.kotlin.jvm") version "1.9.0" apply false
        id("org.jetbrains.kotlin.plugin.serialization") version "1.9.0" apply false
        id("com.google.dagger.hilt.android") version "2.51.1" apply false
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
    versionCatalogs {
        create("androidLibs") {
            from(files("gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "dagmar-native"

include(
    ":app",
    ":core:common",
    ":core:designsystem",
    ":core:network",
    ":core:data",
    ":core:domain",
    ":core:navigation",
    ":core:auth",
    ":core:files",
    ":core:update",
    ":feature:employee-auth",
    ":feature:employee-attendance",
    ":feature:password-reset",
    ":feature:admin-auth",
    ":feature:admin-users",
    ":feature:admin-attendance",
    ":feature:admin-shift-plan",
    ":feature:admin-export",
    ":feature:admin-prints",
    ":feature:admin-settings",
    ":feature:about"
)
