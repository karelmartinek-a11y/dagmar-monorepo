import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application") apply false
    id("com.android.library") apply false
    id("org.jetbrains.kotlin.android") apply false
    id("org.jetbrains.kotlin.plugin.serialization") apply false
    id("com.google.dagger.hilt.android") apply false
}

subprojects {
    afterEvaluate {
        plugins.withId("org.jetbrains.kotlin.android") {
            extensions.configure<KotlinAndroidProjectExtension> {
                jvmToolchain {
                    languageVersion.set(JavaLanguageVersion.of(17))
                }
            }
        }

        plugins.withId("com.android.base") {
            extensions.configure<com.android.build.gradle.BaseExtension> {
                compileOptions {
                    sourceCompatibility = JavaVersion.VERSION_17
                    targetCompatibility = JavaVersion.VERSION_17
                }
            }
        }
    }

    tasks.withType<KotlinCompile>().configureEach {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
            allWarningsAsErrors.set(true)
            
            // Globally replace deprecated -Xopt-in with -opt-in
            freeCompilerArgs.set(freeCompilerArgs.get().map { arg ->
                if (arg.startsWith("-Xopt-in=")) arg.replace("-Xopt-in=", "-opt-in=")
                else arg
            }.filter { it != "-Xopt-in" })
            
            if (freeCompilerArgs.get().none { it.startsWith("-opt-in=") }) {
                freeCompilerArgs.add("-opt-in=kotlin.RequiresOptIn")
            }
        }
    }

    tasks.withType<JavaCompile>().configureEach {
        options.compilerArgs.add("-Werror")
    }
}

tasks.register("clean", Delete::class) {
    delete(layout.buildDirectory)
}
