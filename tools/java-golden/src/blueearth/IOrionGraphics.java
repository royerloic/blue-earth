/*
 * Created on 22.4.2005 by Dipl.-Inf. MSc. Ing Loic Royer
 */
package blueearth;

import java.awt.Frame;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;

public interface IOrionGraphics extends GraphicsProvider
{

	public abstract boolean startGraphics();

	public abstract void setMouseListener(IOrionGraphicsMouseListener pOrionGraphicsMouseListener);

	public abstract IMouseInfo getMouseInfo();

	public abstract void setPixelArray(	int[] pPixelArray,
																			int pOffset,
																			int pScan);

	public abstract void updateAllPixels();

	public abstract void updatePixelArea(int pX, int pY, int pW, int pH);

	public void paintPixels();

	public abstract void show();

	public abstract void stopGraphics();

	@Override
	public abstract Graphics2D getDrawGraphics();

	public abstract int getNumberOfBuffers();

	public abstract void setNumberOfBuffers(int pNumberOfBuffers);

	@Override
	public abstract int getHeight();

	@Override
	public abstract int getWidth();

	public abstract boolean isDisplayFramerate();

	public abstract void setDisplayFramerate(boolean pDisplayFramerate);

	public abstract int getMaxFramesForFrameRate();

	public abstract void setMaxFramesForFrameRate(int pMaxFramesForFrameRate);

	public abstract double getFrameRate();

	public abstract double getInterFrameTime();

	public abstract void minimize();

	public abstract void maximize();

	public abstract void setIconImage(String pIconFileName);

	public abstract void setFrameName(String pName);

	public abstract Frame getFrame();

	public abstract boolean isImageAccelerated(BufferedImage pEarthImage);

}