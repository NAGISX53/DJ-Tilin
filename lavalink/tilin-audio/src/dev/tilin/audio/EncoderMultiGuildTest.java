package dev.tilin.audio;
import java.nio.*;
import com.sedmelluq.discord.lavaplayer.filter.FloatPcmAudioFilter;
public class EncoderMultiGuildTest {
  static class Sink implements FloatPcmAudioFilter {
    final AudioQualityPlugin.AdaptiveEncoder encoder = new AudioQualityPlugin.AdaptiveEncoder();
    final ShortBuffer pcm = ByteBuffer.allocateDirect(3840).order(ByteOrder.nativeOrder()).asShortBuffer();
    final ByteBuffer out = ByteBuffer.allocateDirect(1568);
    int expected;
    Sink(int rate) { expected=rate; }
    public void process(float[][] input,int offset,int length) {
      pcm.clear();for(int i=0;i<1920;i++)pcm.put((short)(1000*Math.sin(i)));pcm.flip();encoder.encode(pcm,out);
      if(out.remaining()!=expected/400)throw new AssertionError("Cross-guild bitrate leak: "+out.remaining()+" expected "+expected/400);
    }
    public void seekPerformed(long a,long b) {} public void flush() {} public void close(){encoder.close();}
  }
  public static void main(String[] args) throws Exception {
    var a=AudioQualityPlugin.profile("111111111111111111");a.bitrate.set(96000);
    var b=AudioQualityPlugin.profile("222222222222222222");b.bitrate.set(384000);
    var sa=new Sink(96000);var sb=new Sink(384000);
    var fa=new AudioQualityPlugin.ProfileFilter(a,sa);var fb=new AudioQualityPlugin.ProfileFilter(b,sb);
    try {
      for(int i=0;i<50;i++){fa.process(null,0,0);fb.process(null,0,0);}
      a.bitrate.set(64000);sa.expected=64000;
      for(int i=0;i<20;i++){fb.process(null,0,0);fa.process(null,0,0);}
      if(AudioQualityPlugin.CONTEXT.get()!=null)throw new AssertionError("Thread context leaked");
      if(a.lastBytes.get()!=160 || b.lastBytes.get()!=960)throw new AssertionError("Incorrect per-guild telemetry");
      System.out.println("OK: independent guilds at 96/384 kbps, live change to 64 kbps, no thread context leak.");
    } finally {fa.close();fb.close();}
  }
}
