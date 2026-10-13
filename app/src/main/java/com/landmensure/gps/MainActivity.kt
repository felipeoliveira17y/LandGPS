package com.landmensure.gps

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContentValues
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.GnssStatus
import android.location.OnNmeaMessageListener
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.os.Handler
import android.view.View
import android.view.WindowInsets
import android.graphics.Color
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var locationManager: LocationManager
    private val locationRequestCode = 1001
    private var pendingStart = false
    private var latestFix: Location? = null
    private var tracking = false
    private val handler = Handler(Looper.getMainLooper())
    private var occupationActive = false
    private var occupationStart = 0L
    private var occupationSeconds = 0
    private val occupationSamples = mutableListOf<Location>()
    private var satellitesVisible = 0
    private var satellitesUsed = 0
    private var satelliteJson = "[]"
    private var lastHdop = -1.0
    private var lastPdop = -1.0
    private var lastVdop = -1.0
    private var lastNmeaSatUsed = -1

    private val nmeaListener = OnNmeaMessageListener { message, _ ->
        parseNmea(message)
    }

    private fun parseNmea(message: String) {
        val f = message.trim().split(",")
        if (f.isEmpty()) return
        try {
            when {
                f[0].endsWith("GGA") && f.size > 8 -> {
                    lastNmeaSatUsed = f[7].toIntOrNull() ?: lastNmeaSatUsed
                    lastHdop = f[8].toDoubleOrNull() ?: lastHdop
                }
                f[0].endsWith("GSA") && f.size >= 18 -> {
                    lastPdop = f.getOrNull(f.size-3)?.substringBefore('*')?.toDoubleOrNull() ?: lastPdop
                    lastHdop = f.getOrNull(f.size-2)?.substringBefore('*')?.toDoubleOrNull() ?: lastHdop
                    lastVdop = f.getOrNull(f.size-1)?.substringBefore('*')?.toDoubleOrNull() ?: lastVdop
                }
            }
            sendDopStatus()
        } catch (_: Exception) {}
    }

    private val gnssCallback = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            satellitesVisible = status.satelliteCount
            var used = 0
            for (i in 0 until status.satelliteCount) if (status.usedInFix(i)) used++
            satellitesUsed = used
            val sats = mutableListOf<String>()
            for (i in 0 until status.satelliteCount) {
                val constellation = when (status.getConstellationType(i)) {
                    GnssStatus.CONSTELLATION_GPS -> "GPS"
                    GnssStatus.CONSTELLATION_GLONASS -> "GLONASS"
                    GnssStatus.CONSTELLATION_BEIDOU -> "BEIDOU"
                    GnssStatus.CONSTELLATION_GALILEO -> "GALILEO"
                    GnssStatus.CONSTELLATION_QZSS -> "QZSS"
                    GnssStatus.CONSTELLATION_SBAS -> "SBAS"
                    GnssStatus.CONSTELLATION_IRNSS -> "NAVIC"
                    else -> "OUTRO"
                }
                val usedFix = status.usedInFix(i)
                val cn0 = status.getCn0DbHz(i)
                val elev = status.getElevationDegrees(i)
                val az = status.getAzimuthDegrees(i)
                val freqHz = if (status.hasCarrierFrequencyHz(i)) status.getCarrierFrequencyHz(i).toDouble() else 0.0
                val freqMHz = if (freqHz > 0.0) freqHz / 1_000_000.0 else 0.0
                val band = classifyBand(constellation, freqMHz)
                sats.add("{\"system\":\"$constellation\",\"svid\":${status.getSvid(i)},\"used\":$usedFix,\"cn0\":${String.format(java.util.Locale.US, "%.1f", cn0)},\"elev\":${String.format(java.util.Locale.US, "%.1f", elev)},\"az\":${String.format(java.util.Locale.US, "%.1f", az)},\"freqMHz\":${String.format(java.util.Locale.US, "%.3f", freqMHz)},\"band\":\"$band\"}")
            }
            satelliteJson = "[" + sats.joinToString(",") + "]"
            sendGnssStatus()
        }
    }

    private fun classifyBand(system: String, mhz: Double): String {
        if (mhz <= 0.0) return "N/D"
        fun near(target: Double, tol: Double = 12.0) = kotlin.math.abs(mhz - target) <= tol
        return when (system) {
            "GPS" -> when { near(1575.42) -> "L1"; near(1227.60) -> "L2"; near(1176.45) -> "L5"; else -> "Outra" }
            "GALILEO" -> when { near(1575.42) -> "E1"; near(1176.45) -> "E5a"; near(1207.14) -> "E5b"; near(1278.75) -> "E6"; else -> "Outra" }
            "BEIDOU" -> when { near(1561.098) || near(1575.42) -> "B1"; near(1207.14) -> "B2"; near(1176.45) -> "B2a"; near(1268.52) -> "B3"; else -> "Outra" }
            "GLONASS" -> when { mhz in 1590.0..1610.0 -> "G1"; mhz in 1235.0..1255.0 -> "G2"; near(1202.025) -> "G3"; else -> "Outra" }
            else -> "Outra"
        }
    }

    private val liveListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            if (location.provider != LocationManager.GPS_PROVIDER) return
            if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return
            if (location.isMock) return
            if (!location.hasAccuracy()) return
            latestFix = Location(location)
            deliverLiveLocation(location)
            if (occupationActive) {
                val age = System.currentTimeMillis() - location.time
                if (age in 0..2500 && location.accuracy <= 50f) occupationSamples.add(Location(location))
            }
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {
            if (provider == LocationManager.GPS_PROVIDER) sendLiveStatus("GPS desativado")
        }
        @Deprecated("Deprecated") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(27, 40, 49))
        webView.setOnApplyWindowInsetsListener { view, insets ->
            val top: Int
            val bottom: Int
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                top = bars.top
                bottom = bars.bottom
                view.setPadding(0, top, 0, bottom)
                WindowInsets.CONSUMED
            } else {
                top = insets.systemWindowInsetTop
                bottom = insets.systemWindowInsetBottom
                view.setPadding(0, top, 0, bottom)
                insets.consumeSystemWindowInsets()
            }
        }
        setContentView(webView)
        webView.requestApplyInsets()
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(AndroidBridge(), "Android")
        webView.loadUrl("file:///android_asset/index.html")
    }

    inner class AndroidBridge {
        @JavascriptInterface fun setDarkBars(dark: Boolean) { runOnUiThread {
            val color = if (dark) Color.rgb(27, 40, 49) else Color.WHITE
            webView.setBackgroundColor(color)
            window.statusBarColor = color
            window.navigationBarColor = color
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                window.insetsController?.setSystemBarsAppearance(if (dark) 0 else mask, mask)
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = if (dark) 0 else
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
        }}

        @JavascriptInterface fun startLiveLocation() { runOnUiThread { ensurePermissionAndStart() } }

        @JavascriptInterface fun startOccupation(seconds: Int) { runOnUiThread {
            if (seconds !in listOf(15,30,60,120)) { sendLocationError("Tempo de ocupação inválido."); return@runOnUiThread }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                pendingStart = true
                requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), locationRequestCode)
                sendLocationError("Conceda Localização precisa e toque novamente em Coletar ponto.")
                return@runOnUiThread
            }
            startLiveTracking()
            if (occupationActive) { sendLocationError("Já existe uma coleta em andamento."); return@runOnUiThread }
            occupationActive = true; occupationSamples.clear(); occupationSeconds = seconds; occupationStart = System.currentTimeMillis()
            sendOccupationProgress(0, seconds, 0, latestFix?.accuracy?.toDouble() ?: -1.0)
            scheduleOccupationTick()
        }}

        @JavascriptInterface fun requestLocation() { // botão Coletar ponto = fotografia da posição AO VIVO atual
            runOnUiThread {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    pendingStart = true
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), locationRequestCode)
                    return@runOnUiThread
                }
                startLiveTracking()
                val loc = latestFix
                if (loc == null) {
                    sendLocationError("Aguardando a primeira posição GPS/GNSS. Espere as coordenadas aparecerem em tempo real e toque novamente em Coletar ponto.")
                    return@runOnUiThread
                }
                val ageMs = System.currentTimeMillis() - loc.time
                if (ageMs > 3000L) {
                    sendLocationError("A posição GPS ainda não está atualizada. Aguarde a leitura em tempo real estabilizar.")
                    return@runOnUiThread
                }
                // Não escolhe 'melhor leitura' de segundos anteriores. Salva exatamente a leitura atual mostrada.
                deliverCapturedLocation(loc)
            }
        }

        @JavascriptInterface fun saveFile(name: String, content: String, mime: String) { runOnUiThread {
            try {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, mime)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/GPS Landmensure")
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                }
                val resolver = contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("Não foi possível criar o arquivo em Downloads")
                try {
                    resolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
                        ?: throw IllegalStateException("Não foi possível gravar o arquivo")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val ready = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                        resolver.update(uri, ready, null, null)
                    }
                } catch (e: Exception) {
                    resolver.delete(uri, null, null)
                    throw e
                }
                Toast.makeText(this@MainActivity, "Arquivo salvo em Downloads/GPS Landmensure: $name", Toast.LENGTH_LONG).show()
            } catch (e: Exception) { Toast.makeText(this@MainActivity, "Erro ao salvar: ${e.message}", Toast.LENGTH_LONG).show() }
        }}

        @JavascriptInterface fun printHtml(jobName: String, html: String) { runOnUiThread {
            val printView = WebView(this@MainActivity); printView.settings.javaScriptEnabled = true
            printView.webViewClient = object : WebViewClient() { override fun onPageFinished(view: WebView?, url: String?) {
                val pm = getSystemService(Context.PRINT_SERVICE) as PrintManager
                pm.print(jobName, printView.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
            }}
            printView.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "UTF-8", null)
        }}
    }

    private fun ensurePermissionAndStart() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            pendingStart = true
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), locationRequestCode)
        } else startLiveTracking()
    }

    @SuppressLint("MissingPermission")
    private fun startLiveTracking() {
        if (tracking) return
        if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) { sendLiveStatus("Ative o GPS do aparelho"); return }
        tracking = true
        // Fluxo contínuo: cada nova solução GNSS substitui a anterior. Não há média/buffer que cause atraso ao caminhar.
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0f, liveListener, Looper.getMainLooper())
        runCatching { locationManager.registerGnssStatusCallback(gnssCallback, handler) }
        runCatching { locationManager.addNmeaListener(nmeaListener, handler) }
        sendLiveStatus("Aguardando fixação GPS/GNSS…")
    }

    private fun scheduleOccupationTick() {
        handler.postDelayed({
            if (!occupationActive) return@postDelayed
            val elapsed = ((System.currentTimeMillis() - occupationStart) / 1000L).toInt()
            sendOccupationProgress(elapsed.coerceAtMost(occupationSeconds), occupationSeconds, occupationSamples.size, latestFix?.accuracy?.toDouble() ?: -1.0)
            if (elapsed >= occupationSeconds) finishOccupation() else scheduleOccupationTick()
        }, 500L)
    }

    private fun finishOccupation() {
        occupationActive = false
        if (occupationSamples.size < 3) { sendLocationError("Poucas leituras GNSS válidas durante a ocupação. Tente novamente em área aberta."); return }
        val samples = occupationSamples.toList()
        val medLat = samples.map { it.latitude }.sorted()[samples.size/2]
        val medLon = samples.map { it.longitude }.sorted()[samples.size/2]
        fun meters(lat:Double, lon:Double):Double {
            val dy=(lat-medLat)*111320.0; val dx=(lon-medLon)*111320.0*kotlin.math.cos(Math.toRadians(medLat)); return kotlin.math.sqrt(dx*dx+dy*dy)
        }
        val ds=samples.map{meters(it.latitude,it.longitude)}.sorted(); val medD=ds[ds.size/2]
        val absDev=ds.map{kotlin.math.abs(it-medD)}.sorted(); val mad=absDev[absDev.size/2]
        val limit=kotlin.math.max(3.0, medD + 3.0*kotlin.math.max(mad,0.5))
        val valid=samples.filter{meters(it.latitude,it.longitude)<=limit}
        if (valid.size < 3) { sendLocationError("As leituras ficaram muito dispersas. Repita a ocupação."); return }
        var sw=0.0; var slat=0.0; var slon=0.0
        valid.forEach { val a=kotlin.math.max(it.accuracy.toDouble(),1.0); val w=1.0/(a*a); sw+=w; slat+=it.latitude*w; slon+=it.longitude*w }
        val lat=slat/sw; val lon=slon/sw
        val radial2=valid.map{ val dy=(it.latitude-lat)*111320.0; val dx=(it.longitude-lon)*111320.0*kotlin.math.cos(Math.toRadians(lat)); dx*dx+dy*dy }
        val spread=kotlin.math.sqrt(radial2.average())
        val std = if (valid.size > 1) kotlin.math.sqrt(radial2.sum()/(valid.size-1)) else spread
        val sem = std / kotlin.math.sqrt(valid.size.toDouble())
        val r95 = 2.4477 * sem
        val reported=valid.map{it.accuracy.toDouble()}.sorted()[valid.size/2]
        webView.evaluateJavascript("receiveOccupationResult($lat,$lon,$reported,${valid.size},$spread,$std,$sem,$r95,$lastHdop,$lastPdop)", null)
    }

    private fun sendDopStatus() {
        webView.evaluateJavascript("receiveDopStatus($lastHdop,$lastPdop,$lastVdop,$lastNmeaSatUsed)", null)
    }

    private fun sendGnssStatus() {
        webView.evaluateJavascript("receiveGnssStatus($satellitesVisible,$satellitesUsed)", null)
        webView.evaluateJavascript("receiveSatelliteDetails($satelliteJson)", null)
    }

    private fun sendOccupationProgress(elapsed:Int,total:Int,samples:Int,acc:Double) {
        webView.evaluateJavascript("receiveOccupationProgress($elapsed,$total,$samples,$acc)", null)
    }

    private fun deliverLiveLocation(location: Location) {
        val lat=location.latitude; val lng=location.longitude; val acc=location.accuracy.toDouble(); val t=location.time
        webView.evaluateJavascript("receiveLiveLocation($lat,$lng,$acc,$t)", null)
    }
    private fun deliverCapturedLocation(location: Location) {
        val lat=location.latitude; val lng=location.longitude; val acc=location.accuracy.toDouble(); val t=location.time
        webView.evaluateJavascript("receiveCapturedLocation($lat,$lng,$acc,$t)", null)
    }
    private fun sendLiveStatus(message: String) { val s=js(message); webView.evaluateJavascript("receiveLiveStatus('$s')", null) }
    private fun sendLocationError(message: String) { val s=js(message); webView.evaluateJavascript("receiveNativeLocationError('$s')", null) }
    private fun js(s:String)=s.replace("\\","\\\\").replace("'","\\'").replace("\n"," ")

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == locationRequestCode) {
            pendingStart = false
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) startLiveTracking()
            else sendLocationError("Ative 'Usar localização precisa' nas permissões do GPS Landmensure.")
        }
    }
    override fun onResume() { super.onResume(); if (::locationManager.isInitialized && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) startLiveTracking() }
    override fun onPause() { super.onPause(); if (::locationManager.isInitialized && tracking) { runCatching{locationManager.removeUpdates(liveListener)}; runCatching{locationManager.unregisterGnssStatusCallback(gnssCallback)}; runCatching{locationManager.removeNmeaListener(nmeaListener)}; tracking=false } }
    @Deprecated("Deprecated in Java") override fun onBackPressed() { if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }
}
