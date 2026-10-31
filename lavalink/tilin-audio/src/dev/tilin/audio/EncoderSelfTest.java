package dev.tilin.audio;

import java.nio.*;
import com.sun.jna.ptr.IntByReference;

public class EncoderSelfTest {
    public static void main(String[] args) {
        var api = AudioQualityPlugin.NativeOpus.API;
        var pcm = ByteBuffer.allocateDirect(3840).order(ByteOrder.nativeOrder()).asShortBuffer();
        var output = ByteBuffer.allocateDirect(1568);
        var decoded = ByteBuffer.allocateDirect(3840).order(ByteOrder.nativeOrder()).asShortBuffer();
        var encoder = new AudioQualityPlugin.AdaptiveEncoder();
        var error = new IntByReference();
        var decoder = api.opus_decoder_create(48000, 2, error);
        if (decoder == null || error.getValue() != 0) throw new AssertionError("Decoder failed");
        try {
            for (int rate : new int[]{8000, 64000, 96000, 128000, 256000, 384000, 96000}) {
                AudioQualityPlugin.BITRATE.set(rate);
                // Existing master volume 50 uses gain tan(50 * .0079) ~= .417.
                // Keep its headroom, including a simulated 200% client gain.
                for (double level : new double[]{0.0, 0.05, 0.2, 0.417}) {
                    for (int frame = 0; frame < 10; frame++) {
                        pcm.clear();
                        for (int i = 0; i < 960; i++) {
                            short value = (short) (Math.sin((frame * 960 + i) * 2 * Math.PI * 440 / 48000) * 32767 * level);
                            pcm.put(value).put(value);
                        }
                        pcm.flip();
                        encoder.encode(pcm, output);
                        if (output.remaining() != rate / 400) throw new AssertionError("Packet bitrate mismatch: " + rate + "/" + output.remaining());
                        decoded.clear();
                        int samples = api.opus_decode(decoder, output, output.remaining(), decoded, 960, 0);
                        if (samples != 960) throw new AssertionError("Decode failed " + samples);
                        for (int i = 0; i < 1920; i++) {
                            int peak = Math.abs((int) decoded.get(i));
                            if (peak >= 32767 || (rate >= 64000 && peak * 2 >= 32767)) throw new AssertionError("Clipped decoded sample at " + rate);
                        }
                    }
                }
                System.out.println("OK: " + rate + " bps, stereo/48kHz, packets and decode without clipping.");
            }
        } finally { encoder.close(); api.opus_decoder_destroy(decoder); }
    }
}
