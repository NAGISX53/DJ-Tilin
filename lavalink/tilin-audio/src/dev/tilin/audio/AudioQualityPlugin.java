package dev.tilin.audio;

import com.sedmelluq.discord.lavaplayer.format.OpusAudioDataFormat;
import com.sedmelluq.discord.lavaplayer.format.transcoder.AudioChunkEncoder;
import com.sedmelluq.discord.lavaplayer.player.AudioConfiguration;
import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.ptr.IntByReference;
import dev.arbjerg.lavalink.api.AudioPlayerManagerConfiguration;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.context.annotation.Bean;
import org.apache.http.client.config.RequestConfig;
import com.sedmelluq.discord.lavaplayer.source.http.HttpAudioSourceManager;
import com.sedmelluq.discord.lavaplayer.track.AudioItem;
import com.sedmelluq.discord.lavaplayer.track.AudioReference;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/** Adaptive encoder for this single-guild music node. No audio gain or EQ. */
@RestController
@RequestMapping("/v4/tilin/audio")
public class AudioQualityPlugin implements AudioPlayerManagerConfiguration {
    @Bean
    public HttpAudioSourceManager localMixSource() { return new LocalMixSource(); }

    public static class LocalMixSource extends HttpAudioSourceManager {
        public LocalMixSource() {
            // Pausing the producer is intentional. A network read timeout would
            // otherwise kill a healthy, paused mix after a few seconds.
            configureRequests(config -> RequestConfig.copy(config)
                .setConnectTimeout(3000).setConnectionRequestTimeout(3000).setSocketTimeout(0).build());
        }
        @Override public String getSourceName() { return "tilinmix"; }
        @Override public AudioItem loadItem(AudioPlayerManager manager, AudioReference reference) {
            if (reference.identifier == null || !reference.identifier.matches("^http://127\\.0\\.0\\.1:[0-9]+/music/[a-f0-9]{48}\\.wav$")) return null;
            return super.loadItem(manager, reference);
        }
    }
    static final AtomicInteger BITRATE = new AtomicInteger(96000);
    static final AtomicInteger LAST_BYTES = new AtomicInteger();
    static final AtomicInteger INPUT_PEAK = new AtomicInteger();
    static final AtomicLong FRAMES = new AtomicLong();

    public interface OpusApi extends Library {
        Pointer opus_encoder_create(int rate, int channels, int application, IntByReference error);
        int opus_encoder_ctl(Pointer encoder, int request, int value);
        int opus_encode(Pointer encoder, ShortBuffer pcm, int samples, ByteBuffer output, int capacity);
        void opus_encoder_destroy(Pointer encoder);
        Pointer opus_decoder_create(int rate, int channels, IntByReference error);
        int opus_decode(Pointer decoder, ByteBuffer packet, int bytes, ShortBuffer pcm, int samples, int fec);
        void opus_decoder_destroy(Pointer decoder);
    }

    static class NativeOpus {
        static final OpusApi API = load();
        private static OpusApi load() {
            try {
                String resource = "/native/libopus.dll";
                var file = Files.createTempFile("tilin-opus-", ".dll");
                try (var input = AudioQualityPlugin.class.getResourceAsStream(resource)) {
                    if (input == null) throw new IllegalStateException("Missing libopus.dll");
                    Files.copy(input, file, StandardCopyOption.REPLACE_EXISTING);
                }
                file.toFile().deleteOnExit();
                return Native.load(file.toAbsolutePath().toString(), OpusApi.class);
            } catch (Exception error) { throw new IllegalStateException("Cannot load Opus", error); }
        }
    }

    @Override
    public AudioPlayerManager configure(AudioPlayerManager manager) {
        manager.getConfiguration().setOpusEncodingQuality(10);
        manager.getConfiguration().setResamplingQuality(AudioConfiguration.ResamplingQuality.HIGH);
        manager.getConfiguration().setOutputFormat(new AdaptiveFormat());
        return manager;
    }

    @GetMapping
    public Map<String, Object> status() {
        return Map.of("bitrate", BITRATE.get(), "sampleRate", 48000, "channels", 2,
            "frameMs", 20, "complexity", 10, "rateMode", "CBR", "lastPacketBytes", LAST_BYTES.get(),
            "encodedFrames", FRAMES.get(), "lastInputPeak", INPUT_PEAK.get());
    }

    @PutMapping
    public Map<String, Object> update(@RequestBody Map<String, Integer> body) {
        int rate = body.getOrDefault("bitrate", 0);
        if (rate < 8000 || rate > 384000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "bitrate must be 8000..384000");
        BITRATE.set(rate);
        return status();
    }

    static class AdaptiveFormat extends OpusAudioDataFormat {
        AdaptiveFormat() { super(2, 48000, 960); }
        @Override
        public AudioChunkEncoder createEncoder(AudioConfiguration configuration) { return new AdaptiveEncoder(); }
    }

    static class AdaptiveEncoder implements AudioChunkEncoder {
        private final OpusApi api = NativeOpus.API;
        private final Pointer encoder;
        private final ByteBuffer scratch = ByteBuffer.allocateDirect(1568);
        private int activeBitrate = -1;
        private boolean closed;
        AdaptiveEncoder() {
            var error = new IntByReference();
            encoder = api.opus_encoder_create(48000, 2, 2049, error); // OPUS_APPLICATION_AUDIO
            if (encoder == null || error.getValue() != 0) throw new IllegalStateException("Opus create: " + error.getValue());
            check(api.opus_encoder_ctl(encoder, 4010, 10)); // complexity
            check(api.opus_encoder_ctl(encoder, 4006, 0)); // CBR: honor channel's packet budget
            check(api.opus_encoder_ctl(encoder, 4024, 3002)); // music signal
        }
        private void check(int error) { if (error < 0) throw new IllegalStateException("Opus error " + error); }
        private int write(ShortBuffer input, ByteBuffer output) {
            if (closed) throw new IllegalStateException("Encoder closed");
            int bitrate = BITRATE.get();
            if (activeBitrate != bitrate) {
                check(api.opus_encoder_ctl(encoder, 4002, bitrate));
                activeBitrate = bitrate;
            }
            int peak = 0;
            for (int i = input.position(); i < input.limit(); i++) peak = Math.max(peak, Math.abs((int) input.get(i)));
            output.clear();
            int bytes = api.opus_encode(encoder, input, 960, output, output.capacity());
            check(bytes);
            output.position(0);
            output.limit(bytes);
            LAST_BYTES.set(bytes);
            INPUT_PEAK.set(peak);
            FRAMES.incrementAndGet();
            return bytes;
        }
        @Override
        public byte[] encode(ShortBuffer input) {
            int length = write(input, scratch);
            byte[] result = new byte[length];
            scratch.get(result);
            return result;
        }
        @Override
        public void encode(ShortBuffer input, ByteBuffer output) {
            if (output.isDirect()) write(input, output);
            else {
                write(input, scratch);
                output.clear();
                output.put(scratch);
                output.flip();
            }
        }
        @Override
        public void close() { if (!closed) { closed = true; api.opus_encoder_destroy(encoder); } }
    }
}
