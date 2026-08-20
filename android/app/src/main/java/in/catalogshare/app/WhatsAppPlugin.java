package in.catalogshare.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Sends an estimate straight to one customer's WhatsApp chat.
 *
 * Why this exists: the standard share sheet (@capacitor/share) can attach the
 * PDF but cannot choose the recipient — it drops the merchant into a contact
 * picker, so the number they just typed into the app is ignored and they have to
 * find the customer again by hand.
 *
 * WhatsApp accepts an undocumented but long-stable `jid` extra on ACTION_SEND
 * that names the recipient as "<countrycode><number>@s.whatsapp.net". Combined
 * with EXTRA_STREAM this opens that specific chat with the PDF already attached.
 *
 * It is undocumented, so every failure path falls back one rung rather than
 * dying: jid+file -> plain file share to WhatsApp -> whatsapp:// text-only deep
 * link -> report failure so the JS layer can use the ordinary share sheet.
 */
@CapacitorPlugin(name = "WhatsAppShare")
public class WhatsAppPlugin extends Plugin {

    private static final String WA_CONSUMER = "com.whatsapp";
    private static final String WA_BUSINESS = "com.whatsapp.w4b";

    /** Which WhatsApp is installed, preferring the consumer app. */
    private String resolveWhatsAppPackage() {
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : new String[] { WA_CONSUMER, WA_BUSINESS }) {
            try {
                pm.getPackageInfo(pkg, 0);
                return pkg;
            } catch (PackageManager.NameNotFoundException ignored) {
                // try the next one
            }
        }
        return null;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        String pkg = resolveWhatsAppPackage();
        result.put("available", pkg != null);
        result.put("packageName", pkg == null ? "" : pkg);
        call.resolve(result);
    }

    /**
     * @param phone    digits only, including country code (e.g. 919876543210)
     * @param text     message body
     * @param fileUri  optional file:// or content:// URI of the PDF to attach
     */
    @PluginMethod
    public void sendToNumber(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        String fileUri = call.getString("fileUri", "");

        if (phone == null) phone = "";
        phone = phone.replaceAll("[^0-9]", "");

        if (phone.isEmpty()) {
            call.reject("A phone number with country code is required");
            return;
        }

        String pkg = resolveWhatsAppPackage();
        if (pkg == null) {
            call.reject("WhatsApp is not installed");
            return;
        }

        Uri attachment = toShareableUri(fileUri);

        // 1. Preferred: the named chat, with the PDF attached.
        if (attachment != null && trySend(pkg, phone, text, attachment)) {
            call.resolve(successResult("chat_with_file", pkg));
            return;
        }

        // 2. The named chat, text only. WhatsApp's own deep link is documented
        //    and reliable, but cannot carry a file.
        if (tryDeepLink(pkg, phone, text)) {
            call.resolve(successResult(attachment == null ? "chat" : "chat_without_file", pkg));
            return;
        }

        // 3. The file, but WhatsApp picks the recipient.
        if (attachment != null && trySend(pkg, null, text, attachment)) {
            call.resolve(successResult("picker_with_file", pkg));
            return;
        }

        call.reject("Could not open WhatsApp");
    }

    /** Turn a file path or file:// URI into something another app may read. */
    private Uri toShareableUri(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            if (raw.startsWith("content://")) return Uri.parse(raw);

            String path = raw.startsWith("file://") ? Uri.parse(raw).getPath() : raw;
            if (path == null) return null;

            File file = new File(path);
            if (!file.exists()) return null;

            // WhatsApp is a different process, so a bare file:// URI would throw
            // FileUriExposedException on API 24+. It has to come from the
            // provider declared in AndroidManifest.xml.
            return FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
        } catch (Exception e) {
            return null;
        }
    }

    private boolean trySend(String pkg, String phone, String text, Uri attachment) {
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setPackage(pkg);
            intent.setType("application/pdf");
            intent.putExtra(Intent.EXTRA_STREAM, attachment);
            if (text != null && !text.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, text);
            }
            if (phone != null && !phone.isEmpty()) {
                intent.putExtra("jid", phone + "@s.whatsapp.net");
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (intent.resolveActivity(getContext().getPackageManager()) == null) return false;
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean tryDeepLink(String pkg, String phone, String text) {
        try {
            String url = "https://wa.me/" + phone;
            if (text != null && !text.isEmpty()) {
                url += "?text=" + Uri.encode(text);
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.setPackage(pkg);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(getContext().getPackageManager()) == null) return false;
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private JSObject successResult(String mode, String pkg) {
        JSObject result = new JSObject();
        result.put("sent", true);
        result.put("mode", mode);
        result.put("packageName", pkg);
        return result;
    }
}
