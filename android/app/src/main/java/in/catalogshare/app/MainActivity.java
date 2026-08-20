package in.catalogshare.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate so the bridge picks it up during
        // initialisation; registering afterwards leaves the JS side calling into
        // a plugin the bridge does not know about.
        registerPlugin(WhatsAppPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
