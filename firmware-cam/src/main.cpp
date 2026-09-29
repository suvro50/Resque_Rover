// ============================================================================
// GridZero — ESP32-CAM Streaming Firmware (Optimized v2.0)
// ============================================================================
// Fixes: Brownout disabled, RGB565 software JPEG (clone OV2640 fix)
// Speed: Double buffer with PSRAM
// Stream: http://<ip>:81/stream  |  Snapshot: http://<ip>:82/capture
// ============================================================================

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "Arduino.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

const char* WIFI_SSID     = "RescueTank";
const char* WIFI_PASSWORD = "12345678";

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define PART_BOUNDARY "gridzero123boundary"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY     = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART         = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;
httpd_handle_t camera_httpd = NULL;

typedef struct { httpd_req_t *req; size_t len; } jpg_chunking_t;

static size_t jpg_encode_stream(void* arg, size_t index, const void* data, size_t len) {
    jpg_chunking_t *j = (jpg_chunking_t *)arg;
    if (!index) j->len = 0;
    if (httpd_resp_send_chunk(j->req, (const char*)data, len) != ESP_OK) return 0;
    j->len += len;
    return len;
}

static esp_err_t capture_handler(httpd_req_t *req) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { httpd_resp_send_500(req); return ESP_FAIL; }
    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    if (fb->format == PIXFORMAT_JPEG) {
        httpd_resp_send(req, (const char*)fb->buf, fb->len);
    } else {
        jpg_chunking_t jchunk = {req, 0};
        frame2jpg_cb(fb, 50, jpg_encode_stream, &jchunk);
        httpd_resp_send_chunk(req, NULL, 0);
    }
    esp_camera_fb_return(fb);
    return ESP_OK;
}

static esp_err_t stream_handler(httpd_req_t *req) {
    camera_fb_t* fb   = NULL;
    esp_err_t res     = ESP_OK;
    size_t _jpg_buf_len = 0;
    uint8_t* _jpg_buf   = NULL;
    char part_buf[64];

    httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    Serial.println("Stream client connected");

    while (true) {
        fb = esp_camera_fb_get();
        if (!fb) {
            res = ESP_FAIL;
        } else {
            if (fb->format != PIXFORMAT_JPEG) {
                bool ok = frame2jpg(fb, 50, &_jpg_buf, &_jpg_buf_len);
                esp_camera_fb_return(fb); fb = NULL;
                if (!ok) res = ESP_FAIL;
            } else {
                _jpg_buf_len = fb->len;
                _jpg_buf     = fb->buf;
            }
        }
        if (res == ESP_OK) {
            size_t hlen = snprintf(part_buf, 64, STREAM_PART, _jpg_buf_len);
            res = httpd_resp_send_chunk(req, part_buf, hlen);
        }
        if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char*)_jpg_buf, _jpg_buf_len);
        if (res == ESP_OK) res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
        if (fb)        { esp_camera_fb_return(fb); fb = NULL; _jpg_buf = NULL; }
        else if (_jpg_buf) { free(_jpg_buf); _jpg_buf = NULL; }
        if (res != ESP_OK) break;
    }
    return res;
}

void startCameraServer() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 81;
    httpd_uri_t stream_uri  = { .uri="/stream",  .method=HTTP_GET, .handler=stream_handler,  .user_ctx=NULL };
    httpd_uri_t capture_uri = { .uri="/capture", .method=HTTP_GET, .handler=capture_handler, .user_ctx=NULL };
    if (httpd_start(&stream_httpd, &config) == ESP_OK)
        httpd_register_uri_handler(stream_httpd, &stream_uri);
    config.server_port = 82;
    config.ctrl_port   = 32769;
    if (httpd_start(&camera_httpd, &config) == ESP_OK)
        httpd_register_uri_handler(camera_httpd, &capture_uri);
}

void setup() {
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout

    Serial.begin(115200);
    delay(500);
    Serial.println("\nGridZero ESP32-CAM v2.0 starting...");

    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0       = Y2_GPIO_NUM;
    config.pin_d1       = Y3_GPIO_NUM;
    config.pin_d2       = Y4_GPIO_NUM;
    config.pin_d3       = Y5_GPIO_NUM;
    config.pin_d4       = Y6_GPIO_NUM;
    config.pin_d5       = Y7_GPIO_NUM;
    config.pin_d6       = Y8_GPIO_NUM;
    config.pin_d7       = Y9_GPIO_NUM;
    config.pin_xclk     = XCLK_GPIO_NUM;
    config.pin_pclk     = PCLK_GPIO_NUM;
    config.pin_vsync    = VSYNC_GPIO_NUM;
    config.pin_href     = HREF_GPIO_NUM;
    config.pin_sscb_sda = SIOD_GPIO_NUM;
    config.pin_sscb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn     = PWDN_GPIO_NUM;
    config.pin_reset    = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_RGB565; // Clone OV2640 fix
    config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY; // Always get latest frame

    if (psramFound()) {
        config.frame_size   = FRAMESIZE_QVGA;
        config.jpeg_quality = 10;
        config.fb_count     = 2;
        Serial.println("PSRAM found - double buffer mode");
    } else {
        config.frame_size   = FRAMESIZE_QVGA;
        config.jpeg_quality = 12;
        config.fb_count     = 1;
    }

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("Camera init failed: 0x%x\n", err);
        return;
    }
    Serial.println("Camera OK!");

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.println("\nWiFi Connected!");
    Serial.print("IP: "); Serial.println(WiFi.localIP());

    startCameraServer();

    Serial.printf("Stream:  http://%s:81/stream\n", WiFi.localIP().toString().c_str());
    Serial.printf("Capture: http://%s:82/capture\n", WiFi.localIP().toString().c_str());
}

void loop() {
    delay(1);
}