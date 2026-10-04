package blueearth;

import java.awt.Component;
import java.awt.Frame;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.BufferedOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.GZIPOutputStream;

/**
 * Runs the (seeded) original BlueEarth headlessly at 800x600 with a scripted mouse and dumps:
 *   inputs.binz        Java-decoded inputs: worldR, worldG, worldB (u8), topo (i16 LE), lightR/G/B (u8)
 *   frame-NNNN.binz    the pixel array (i32 LE, 0xAARRGGBB) after frame NNNN, before text overlays
 * (.binz = raw gzip). Usage: java blueearth.GoldenHarness <mouse-script.txt> <outDir> <lastFrame> <frames...>
 */
public class GoldenHarness implements IOrionGraphics, IMouseInfo {
	static final int W = 800, H = 600;

	final List<int[]> segments = new ArrayList<>();
	final int lastFrame;
	final int[] dumpFrames;
	final File outDir;
	BlueEarth earth;
	int[] pixels;
	int frame = 0; // number of completed frames
	int mx, my;
	boolean left;
	final BufferedImage canvas = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);

	GoldenHarness(File script, File outDir, int lastFrame, int[] dumpFrames) throws IOException {
		for (String line : Files.readAllLines(script.toPath())) {
			line = line.trim();
			if (line.isEmpty() || line.startsWith("#")) continue;
			segments.add(Arrays.stream(line.split("\\s+")).mapToInt(Integer::parseInt).toArray());
		}
		this.outDir = outDir;
		this.lastFrame = lastFrame;
		this.dumpFrames = dumpFrames;
		setMouseFor(1);
	}

	/** Mouse state used during frame t (BlueEarth's lTime). */
	void setMouseFor(int t) {
		mx = 400; my = 300; left = false;
		for (int[] s : segments) {
			if (t >= s[0] && t <= s[1]) {
				double a = s[1] == s[0] ? 0 : (double) (t - s[0]) / (s[1] - s[0]);
				mx = (int) Math.floor(s[2] + a * (s[4] - s[2]));
				my = (int) Math.floor(s[3] + a * (s[5] - s[3]));
				left = s[6] != 0;
			}
		}
	}

	static DataOutputStream gz(File f) throws IOException {
		return new DataOutputStream(new BufferedOutputStream(new GZIPOutputStream(new FileOutputStream(f))));
	}

	void dumpInputs() throws IOException {
		try (DataOutputStream o = gz(new File(outDir, "inputs.binz"))) {
			for (int[] plane : new int[][] { earth.lWorldMapR, earth.lWorldMapG, earth.lWorldMapB })
				for (int v : plane) o.writeByte(v);
			for (int v : earth.lWorldMapTopo) o.writeShort(Short.reverseBytes((short) v));
			for (int[] plane : new int[][] { earth.lLightMapR, earth.lLightMapG, earth.lLightMapB })
				for (int v : plane) o.writeByte(v);
		}
	}

	void dumpFrame(int t) throws IOException {
		try (DataOutputStream o = gz(new File(outDir, String.format("frame-%04d.binz", t)))) {
			for (int v : pixels) o.writeInt(Integer.reverseBytes(v));
		}
	}

	// --- IOrionGraphics ---
	public void setPixelArray(int[] p, int o, int s) { pixels = p; }
	public void updateAllPixels() {
		try {
			int t = frame + 1;
			if (t == 1) dumpInputs();
			for (int d : dumpFrames) if (d == t) dumpFrame(t);
		} catch (IOException e) { throw new RuntimeException(e); }
	}
	public void show() { frame++; setMouseFor(frame + 1); }
	public boolean getMouseRight() { return frame >= lastFrame; }

	public boolean startGraphics() { return true; }
	public void stopGraphics() {}
	public void setMouseListener(IOrionGraphicsMouseListener l) {}
	public IMouseInfo getMouseInfo() { return this; }
	public void updatePixelArea(int a, int b, int c, int d) {}
	public void paintPixels() {}
	public Graphics2D getDrawGraphics() { return canvas.createGraphics(); }
	public int getNumberOfBuffers() { return 2; }
	public void setNumberOfBuffers(int n) {}
	public int getHeight() { return H; }
	public int getWidth() { return W; }
	public boolean isDisplayFramerate() { return false; }
	public void setDisplayFramerate(boolean b) {}
	public int getMaxFramesForFrameRate() { return 0; }
	public void setMaxFramesForFrameRate(int n) {}
	public double getFrameRate() { return 0; }
	public double getInterFrameTime() { return 0; }
	public void minimize() {}
	public void maximize() {}
	public void setIconImage(String s) {}
	public void setFrameName(String s) {}
	public Frame getFrame() { return null; }
	public boolean isImageAccelerated(BufferedImage b) { return false; }
	public Component getComponent() { return null; }
	public void flip() {}
	public boolean isDecorated() { return false; }
	public void dispose() {}
	// --- IMouseInfo ---
	public int getMouseX() { return mx; }
	public int getMouseY() { return my; }
	public int getMouseDeltaZ() { return 0; }
	public boolean getMouseLeft() { return left; }
	public boolean getMouseMiddle() { return false; }
	public boolean getCtrl() { return false; }
	public boolean getAlt() { return false; }
	public boolean getShift() { return false; }

	public static void main(String[] a) throws IOException {
		File out = new File(a[1]);
		out.mkdirs();
		int[] frames = Arrays.stream(a, 3, a.length).mapToInt(Integer::parseInt).toArray();
		GoldenHarness h = new GoldenHarness(new File(a[0]), out, Integer.parseInt(a[2]), frames);
		h.earth = new BlueEarth(h);
		h.earth.start();
		System.out.println("done: " + h.frame + " frames");
	}
}
