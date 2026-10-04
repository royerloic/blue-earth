package blueearth;

import java.awt.Color;
import java.awt.DisplayMode;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.HeadlessException;
import java.awt.Image;
import java.awt.RenderingHints;
import java.awt.Toolkit;
import java.awt.image.BufferedImage;
import java.awt.image.PixelGrabber;

public class BlueEarth
{
	// GOLDEN: seeded RNG so frames are reproducible (seed via -Dblueearth.seed, default 2004).
	static final java.util.Random sRandom = new java.util.Random(Long.getLong("blueearth.seed", 2004L));

	private final IOrionGraphics mOrionGraphics;

	private final int mWidth;

	private final int mHeight;

	private IMouseInfo mMouseInfo;

	private DisplayMode mDisplayMode;

	int mSeaLevel;

	int[] lWorldMap;

	int[] lWorldMapR;

	int[] lWorldMapG;

	int[] lWorldMapB;

	int[] lWorldMapTopo;

	int[] lWorldMapGradX;

	int[] lWorldMapGradY;

	int[] lLightMap;

	int[] lLightMapR;

	int[] lLightMapG;

	int[] lLightMapB;

	/**
	 * @param pOrionGraphics
	 * @throws HeadlessException
	 */
	public BlueEarth(IOrionGraphics pOrionGraphics) throws HeadlessException
	{
		mOrionGraphics = pOrionGraphics;
		mWidth = mOrionGraphics.getWidth();
		mHeight = mOrionGraphics.getHeight();

	}

	public Graphics getMyGraphics()
	{
		final Graphics lGraphics = mOrionGraphics.getDrawGraphics();
		final Color lColor = new Color(1.0f, 0.0f, 0.0f);
		lGraphics.setColor(lColor);
		final Font lFontTitle = new Font(null, Font.ITALIC, 90);
		final Font lFontSubTitle = new Font(null, Font.ITALIC, 30);
		return lGraphics;
	}

	public void getWorldMap(final int pWidth, final int pHeight)
	{

		final Toolkit toolkit = Toolkit.getDefaultToolkit();
		final Image lWorldMapImage = toolkit.getImage(ClassLoader.getSystemResource("blueearth/images/world.jpg"));

		final Image lResizedWorldMapImage = lWorldMapImage.getScaledInstance(	pWidth,
																																		pHeight,
																																		Image.SCALE_SMOOTH);

		lWorldMap = new int[pWidth * pHeight];

		final PixelGrabber lPixelGrabber = new PixelGrabber(lResizedWorldMapImage,
																									0,
																									0,
																									pWidth,
																									pHeight,
																									lWorldMap,
																									0,
																									pWidth);
		try
		{
			lPixelGrabber.grabPixels();
		}
		catch (final InterruptedException e)
		{
			System.err.println("interrupted waiting for pixels!");
		}

		lWorldMapR = new int[pWidth * pHeight];
		lWorldMapG = new int[pWidth * pHeight];
		lWorldMapB = new int[pWidth * pHeight];

		for (int i = 0; i < pWidth * pHeight; i++)
		{
			lWorldMapR[i] = (lWorldMap[i] & 0x00FF0000) >> 16;
			lWorldMapG[i] = (lWorldMap[i] & 0x0000FF00) >> 8;
			lWorldMapB[i] = ((lWorldMap[i] & 0x000000FF));
		}
	}

	public void getWorldTopography(final int pWidth, final int pHeight)
	{

		final Toolkit toolkit = Toolkit.getDefaultToolkit();
		final Image lWorldTopographyImage = toolkit.getImage(ClassLoader.getSystemResource("blueearth/images/worldtopo.jpg"));

		final Image lResizedWorldTopographyImage = lWorldTopographyImage.getScaledInstance(	pWidth,
																																									pHeight,
																																									Image.SCALE_SMOOTH);

		lWorldMapTopo = new int[pWidth * pHeight];

		final PixelGrabber lPixelGrabber1 = new PixelGrabber(	lResizedWorldTopographyImage,
																										0,
																										0,
																										pWidth,
																										pHeight,
																										lWorldMapTopo,
																										0,
																										pWidth);

		try
		{
			lPixelGrabber1.grabPixels();
		}
		catch (final InterruptedException e)
		{
			System.err.println("interrupted waiting for pixels!");
		}

		for (int i = 0; i < pWidth * pHeight; i++)
		{
			lWorldMapTopo[i] = ((lWorldMapTopo[i] & 0x000000FF) - 126) * 4;
		}

		lWorldMapGradX = new int[pWidth * pHeight];
		lWorldMapGradY = new int[pWidth * pHeight];
		for (int i = pWidth; i < pWidth * (pHeight - 1); i++)
		{
			lWorldMapGradX[i] = (lWorldMapTopo[i - 1] - lWorldMapTopo[i + 1]);
			lWorldMapGradY[i] = (lWorldMapTopo[i - pWidth] - lWorldMapTopo[i + pWidth]);
		}

	}

	public void getLightMap(final int pWidth, final int pHeight)
	{

		final Toolkit toolkit = Toolkit.getDefaultToolkit();
		final Image lWorldMapImage = toolkit.getImage(ClassLoader.getSystemResource("blueearth/images/LightMapOcean.jpg"));

		final Image lResizedWorldMapImage = lWorldMapImage.getScaledInstance(	pWidth,
																																		pHeight,
																																		Image.SCALE_SMOOTH);

		lLightMap = new int[pWidth * pHeight];

		final PixelGrabber lPixelGrabber = new PixelGrabber(lResizedWorldMapImage,
																									0,
																									0,
																									pWidth,
																									pHeight,
																									lLightMap,
																									0,
																									pWidth);
		try
		{
			lPixelGrabber.grabPixels();
		}
		catch (final InterruptedException e)
		{
			System.err.println("interrupted waiting for pixels!");
		}

		lLightMapR = new int[pWidth * pHeight];
		lLightMapG = new int[pWidth * pHeight];
		lLightMapB = new int[pWidth * pHeight];

		for (int i = 0; i < pWidth * pHeight; i++)
		{
			lLightMapR[i] = (lLightMap[i] & 0x00FF0000) >> 16;
			lLightMapG[i] = (lLightMap[i] & 0x0000FF00) >> 8;
			lLightMapB[i] = ((lLightMap[i] & 0x000000FF));
		}

	}

	BufferedImage drawTitle()
	{
		final int lTitleWidth = 480;
		final int lTitleHeight = 150;
		final Color lTitleColor = new Color(0.1f, 0.1f, 1.0f);
		final Color lTitleColorShadow = new Color(0.05f, 0.05f, 0.5f);
		final Font lFontTitle = new Font(null, Font.ITALIC, 90);

		final BufferedImage lBufferedImageTitle = new BufferedImage(lTitleWidth,
																													lTitleHeight,
																													BufferedImage.TYPE_INT_ARGB);
		final Graphics2D lTitleGraphics2D = lBufferedImageTitle.createGraphics();

		lTitleGraphics2D.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
																			RenderingHints.VALUE_ANTIALIAS_ON);
		lTitleGraphics2D.setFont(lFontTitle);
		lTitleGraphics2D.setColor(lTitleColorShadow);
		lTitleGraphics2D.drawString("Blue Earth",
																0.01f * lTitleWidth,
																0.51f * lTitleHeight);

		lTitleGraphics2D.setColor(lTitleColor);
		lTitleGraphics2D.drawString("Blue Earth", 0f, 0.5f * lTitleHeight);

		lTitleGraphics2D.dispose();

		return lBufferedImageTitle;
	}

	BufferedImage drawSubTitle()
	{
		final int lSubTitleWidth = 469;
		final int lSubTitleHeight = 50;
		final Color lTitleColor = new Color(0.1f, 0.1f, 1.0f);
		final Font lFontSubTitle = new Font(null, Font.ITALIC, 16);

		final BufferedImage lBufferedImageTitle = new BufferedImage(lSubTitleWidth,
																													lSubTitleHeight,
																													BufferedImage.TYPE_INT_ARGB);
		final Graphics2D lTitleGraphics2D = lBufferedImageTitle.createGraphics();

		lTitleGraphics2D.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
																			RenderingHints.VALUE_ANTIALIAS_ON);

		lTitleGraphics2D.setFont(lFontSubTitle);
		lTitleGraphics2D.drawString("Designed and coded by Loic Royer in 100% pure Java, 2004.",
																0,
																0.5f * lSubTitleHeight);

		return lBufferedImageTitle;
	}

	public void start()
	{

		getWorldMap(mWidth, mHeight);
		getWorldTopography(mWidth, mHeight);
		getLightMap(512, 512);

		final int lSize = mWidth * mHeight;
		final int lPixel[] = new int[lSize];

		int lHeightMatrix1[] = new int[lSize];
		int lHeightMatrix2[] = new int[lSize];
		int lHeightMatrixTemp[];

		for (int index = 0; index < lSize; index++)
		{
			lHeightMatrix1[index] = (int) (sRandom.nextDouble() * 8 - 4); // GOLDEN: was Math.random()
			lHeightMatrix2[index] = lHeightMatrix1[index] / 2;
		}

		final BufferedImage lTitle = drawTitle();
		final BufferedImage lSubTitle = drawSubTitle();

		mOrionGraphics.startGraphics();
		mOrionGraphics.setPixelArray(lPixel, 0, mWidth);
		mMouseInfo = mOrionGraphics.getMouseInfo();

		double lTime = 0;
		mSeaLevel = 2 * 256;
		int mSunX = mWidth / 2;
		int mSunY = mHeight / 2;
		while (!mMouseInfo.getMouseRight())
		{
			lTime += 1;

			if (lTime < 256)
			{
				mSeaLevel = 2 * 256 - 2 * ((int) lTime);
			}
			else /**/if ((mMouseInfo.getMouseY() > 590) && (mMouseInfo.getMouseLeft()))
			{
				mSeaLevel = ((mMouseInfo.getMouseX() - 400) * 130) / 100;
			}

			mSunX = (3 * mSunX + mMouseInfo.getMouseX()) / 4;
			mSunY = (3 * mSunY + mMouseInfo.getMouseY()) / 4;

			if (mMouseInfo.getMouseLeft())
				for (int ly = -3; ly < 3; ly++)
					for (int lx = -3; lx < 3; lx++)
					{

						int lIndex = mMouseInfo.getMouseX() + lx
													+ mWidth
													* (mMouseInfo.getMouseY() + ly);
						if (lIndex < 0)
						{
							lIndex = 0;
						}
						else if (lIndex >= lSize)
						{
							lIndex = lSize - 1;
						}
						if (lHeightMatrix2[lIndex] + mSeaLevel > lWorldMapTopo[lIndex])
						{
							lHeightMatrix1[lIndex] = (int) (180 * Math.cos(0.5 * lTime));
							lHeightMatrix2[lIndex] = (int) (180 * Math.sin(0.5 * lTime));
						}
					}

			for (int index = (mHeight / 5) * mWidth; index < (lSize - (mHeight / 5) * mWidth); index++)
			{
				lHeightMatrix2[index] = (lHeightMatrix1[index + 1 * mWidth] + lHeightMatrix1[index - 1
																																											* mWidth]
																	+ lHeightMatrix1[index + 1 * 1] + lHeightMatrix1[index - 1 * 1]) / 2
																- lHeightMatrix2[index];

				if (lWorldMapTopo[index] <= mSeaLevel)
				{

					final int gX = lHeightMatrix1[index - 1] - lHeightMatrix1[index + 1];
					final int gY = lHeightMatrix1[index - mWidth] - lHeightMatrix1[index + mWidth];

					final int lLightX = (256 + gX + ((index % mWidth) - mSunX) / 4);
					final int lLightY = (256 + gY + ((index / mWidth) - mSunY) / 4);
					int lLight = lLightX + (lLightY << 9);

					if (lLight >= 512 * 512)
					{
						lLight = 512 * 512 - 1;
					}
					else if (lLight < 0)
					{
						lLight = 0;
					}

					lPixel[index] = lLightMap[lLight];

				}
				else if (lHeightMatrix2[index] + mSeaLevel > (lWorldMapTopo[index]))
				{

					final int gX = lHeightMatrix1[index - 1] - lHeightMatrix1[index + 1];
					final int gY = lHeightMatrix1[index - mWidth] - lHeightMatrix1[index + mWidth];

					final int lWLightX = (256 + ((index % mWidth) - mSunX) / 4);
					final int lWLightY = (256 + ((index / mWidth) - mSunY) / 4);
					final int lWLight = lWLightX + (lWLightY << 9);

					final int lLightX = (gX + lWLightX);
					final int lLightY = (gY + lWLightY);
					int lLight = lLightX + (lLightY << 9);

					if (lLight >= 512 * 512)
					{
						lLight = 512 * 512 - 1;
					}
					else if (lLight < 0)
					{
						lLight = 0;
					}

					final int lWR = ((lWorldMapR[index] * lLightMapR[lWLight])) >> 8;
					final int lWG = ((lWorldMapG[index] * lLightMapG[lWLight])) >> 8;
					final int lWB = ((lWorldMapB[index] * lLightMapB[lWLight])) >> 8;

					lPixel[index] = (((((lLightMapR[lLight]) + lWR)) << (15)) & 0x00FF0000) + (((((lLightMapG[lLight]) + lWG)) << (7)) & 0x0000FF00)
													+ (((((lLightMapB[lLight]) + lWB)) >> 1) & 0x000000FF);/**/

					lHeightMatrix2[index] = lHeightMatrix2[index] - lHeightMatrix2[index]
																	/ 64;
					// lWorldMapTopo[index] = (lWorldMapTopo[index] +
					// lHeightMatrix2[index])/2;
				}
				else
				{ // Rendering of land masses.
					lHeightMatrix2[index] = lWorldMapTopo[index] / 6;

					final int lLightX = (256 + lWorldMapGradX[index] + ((index % mWidth) - mSunX) / 4);
					final int lLightY = (256 + lWorldMapGradY[index] + ((index / mWidth) - mSunY) / 4);

					int lLight = lLightX + (lLightY << 9);

					if (lLight >= 512 * 512)
					{
						lLight = 512 * 512 - 1;
					}
					else if (lLight < 0)
					{
						lLight = 0;
					}

					lLight = lLightMap[lLight] & 0x000000FF;

					final int lR = ((lWorldMapR[index]) * lLight) >> 8;
					final int lG = ((lWorldMapG[index]) * lLight) >> 8;
					final int lB = ((lWorldMapB[index]) * lLight) >> 8;

					lPixel[index] = ((lR << 16) + (lG << 8) + lB);

				} /**/

			}

			lHeightMatrixTemp = lHeightMatrix1;
			lHeightMatrix1 = lHeightMatrix2;
			lHeightMatrix2 = lHeightMatrixTemp; /**/

			mOrionGraphics.updateAllPixels();
			mOrionGraphics.paintPixels();

			final Graphics2D lGraphics = mOrionGraphics.getDrawGraphics();
			lGraphics.drawImage(lTitle,
													(mWidth - lTitle.getWidth()) / 2,
													25,
													lTitle.getWidth(),
													lTitle.getHeight(),
													null);/**/

			lGraphics.drawImage(lSubTitle,
													(mWidth - lSubTitle.getWidth()) / 2,
													(int) (0.95 * mHeight),
													lSubTitle.getWidth(),
													lSubTitle.getHeight(),
													null);/**/
			lGraphics.dispose();

			mOrionGraphics.show();
		}
		mOrionGraphics.stopGraphics();

	}

	// GOLDEN: main() removed; tools/java-golden/src/blueearth/GoldenHarness.java drives start().
}
