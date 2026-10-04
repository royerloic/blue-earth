package blueearth;

import java.awt.Component;
import java.awt.Graphics2D;

public interface GraphicsProvider
{
	public int getHeight();

	public int getWidth();

	public Component getComponent();

	public void flip();

	public Graphics2D getDrawGraphics();

	public boolean isDecorated();

	public void dispose();
}
