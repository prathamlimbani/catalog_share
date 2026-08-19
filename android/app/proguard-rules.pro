# ============================================================================
#  CatalogShare - R8 / ProGuard configuration
# ============================================================================
#  minifyEnabled is TRUE for release. Everything below exists because R8 would
#  otherwise strip or rename something that is only ever reached reflectively,
#  which produces a release build that installs fine and then fails at runtime
#  with an empty white WebView and no useful stack trace.
# ============================================================================


# ---------------------------------------------------------------------------
# Crash reports
# ---------------------------------------------------------------------------
# Keep enough metadata that Play Console stack traces are readable after the
# mapping file is uploaded (Play does that automatically for AAB builds).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
# Annotations, generics and inner-class links are all read reflectively by the
# Capacitor bridge and by Gson-style serializers inside Razorpay.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions


# ---------------------------------------------------------------------------
# Capacitor bridge
# ---------------------------------------------------------------------------
# The bridge builds its plugin registry by reflecting over @CapacitorPlugin
# classes at startup and then dispatches JS calls to @PluginMethod methods BY
# NAME. Renaming either one silently breaks every native call the app makes.
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }

-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
    public <init>(...);
}
# Legacy annotation location, still used by a few community plugins.
-keep @com.getcapacitor.NativePlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
    public <init>(...);
}
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keep class * extends com.getcapacitor.Plugin { *; }

# Plugins are named as strings in capacitor.plugins.json and instantiated by
# reflection, so the generated registry and every bundled plugin package stays.
-keep class in.catalogshare.app.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class com.getcapacitor.plugin.** { *; }

# Cordova plugin shim that Capacitor loads for any bridged Cordova plugins.
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**


# ---------------------------------------------------------------------------
# JavaScript <-> Java interface
# ---------------------------------------------------------------------------
# Anything reachable from JS via addJavascriptInterface is called by name from
# the WebView. This single rule is the one Razorpay's integration guide also
# requires, and the one whose absence breaks the Capacitor postMessage channel.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class android.webkit.JavascriptInterface { *; }
-keepattributes JavascriptInterface


# ---------------------------------------------------------------------------
# AndroidX WebKit
# ---------------------------------------------------------------------------
# androidx.webkit resolves the WebView provider through a reflective boundary
# interface; obfuscating it throws IncompatibleWebViewProviderException.
-keep class androidx.webkit.** { *; }
-keep class org.chromium.support_lib_boundary.** { *; }
-dontwarn androidx.webkit.**


# ---------------------------------------------------------------------------
# Google Mobile Ads (AdMob)
# ---------------------------------------------------------------------------
# The Ads SDK loads mediation adapters and its dynamite module by class name.
-keep class com.google.android.gms.ads.** { *; }
-keep interface com.google.android.gms.ads.** { *; }
-keep class com.google.android.gms.internal.ads.** { *; }
-keep class com.google.android.ump.** { *; }
-dontwarn com.google.android.gms.ads.**
-dontwarn com.google.android.ump.**
# Play Services base classes referenced from the manifest / meta-data.
-keep class com.google.android.gms.common.** { *; }
-dontwarn com.google.android.gms.**


# ---------------------------------------------------------------------------
# Razorpay checkout
# ---------------------------------------------------------------------------
# Razorpay's own published rules: the SDK is a WebView wrapper that talks to its
# JS layer by interface name and parses responses into annotated model classes.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepclassmembers class com.razorpay.** { *; }
-keep class com.razorpay.** { *; }
-dontwarn com.razorpay.**
# proguard.annotation is shipped by Razorpay and marks its own keep-set.
-keep class proguard.annotation.Keep
-keep class proguard.annotation.KeepClassMembers
-keep @proguard.annotation.Keep class * { *; }
-keepclassmembers class * {
    @proguard.annotation.Keep *;
}
-dontwarn proguard.annotation.**


# ---------------------------------------------------------------------------
# Kotlin
# ---------------------------------------------------------------------------
# Several Capacitor plugins (camera, filesystem, admob) are written in Kotlin and
# their reflection / coroutines paths read @Metadata.
-keep class kotlin.Metadata { *; }
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keep class kotlin.coroutines.Continuation
-dontwarn kotlin.**
-dontwarn kotlinx.**


# ---------------------------------------------------------------------------
# Misc third-party noise
# ---------------------------------------------------------------------------
# OkHttp / Okio pull in optional Conscrypt + Animal Sniffer references that are
# never present at runtime on Android.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**

# Native methods are bound by JNI signature, never by the mapping file.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Parcelable CREATOR fields and enum valueOf/values are reflected by the
# framework itself.
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Views inflated from XML and their setters used by data binding / animations.
-keepclassmembers class * extends android.app.Activity {
    public void *(android.view.View);
}
