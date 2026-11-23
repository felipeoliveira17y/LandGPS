-keepattributes RuntimeVisibleAnnotations
-keepclassmembers class com.landmensure.gps.MainActivity$AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Compile-time annotations referenced by Tink and SLF4J's optional logging binder.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy
-dontwarn org.slf4j.impl.StaticLoggerBinder
