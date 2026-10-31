import com.sedmelluq.discord.lavaplayer.filter.FloatPcmAudioFilter;
import com.sedmelluq.discord.lavaplayer.filter.equalizer.Equalizer;
import java.util.Random;

public class EqualizerSignalTest {
    static class Meter implements FloatPcmAudioFilter {
        float peak;
        float rightPeak;
        public void process(float[][] input, int offset, int length) {
            for (int i = offset; i < offset + length; i++) {
                peak = Math.max(peak, Math.abs(input[0][i]));
                rightPeak = Math.max(rightPeak, Math.abs(input[1][i]));
                if (!Float.isFinite(input[0][i]) || Math.abs(input[0][i]) >= 0.99999f) throw new AssertionError("Saturation or invalid sample");
            }
        }
        public void seekPerformed(long a, long b) {}
        public void flush() {}
        public void close() {}
    }
    public static void main(String[] args) throws Exception {
        String[] fields = args[0].split(",");
        float[] gains = new float[15];
        for (int i = 0; i < gains.length; i++) gains[i] = Float.parseFloat(fields[i]);
        float preamp = Float.parseFloat(args[1]);
        float maximum = 0;
        for (int tone = 0; tone < 40; tone++) {
            double frequency = 20 * Math.pow(1000, tone / 39.0);
            var meter = new Meter();
            var equalizer = new Equalizer(2, meter, gains);
            float[][] pcm = new float[2][48000];
            for (int i = 0; i < pcm[0].length; i++) pcm[0][i] = (float) Math.sin(i * 2 * Math.PI * frequency / 48000) * preamp;
            equalizer.process(pcm, 0, pcm[0].length);
            if (meter.rightPeak != 0) throw new AssertionError("Stereo crosstalk");
            maximum = Math.max(maximum, meter.peak);
        }
        var random = new Random(100);
        for (int waveform = 0; waveform < 3; waveform++) {
            var meter = new Meter();
            var equalizer = new Equalizer(2, meter, gains);
            float[][] pcm = new float[2][48000];
            for (int i = 0; i < pcm[0].length; i++) {
                double wave = waveform == 0 ? (i == 0 ? 1 : 0) : waveform == 1 ? (i % 480 < 240 ? 1 : -1) : random.nextDouble() * 2 - 1;
                pcm[0][i] = (float) wave * preamp;
            }
            equalizer.process(pcm, 0, pcm[0].length);
            maximum = Math.max(maximum, meter.peak);
        }
        System.out.printf("OK: 40 tones 20Hz..20kHz, impulse, square wave and noise; peak %.4f, no saturation or stereo crosstalk.%n", maximum);
    }
}
