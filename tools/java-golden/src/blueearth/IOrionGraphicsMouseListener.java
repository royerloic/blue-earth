/**
 * Created on 6 mai 2005
 * By Dipl.-Inf. MSC. Ing. Loic Royer
 * 
 */
package blueearth;

import java.awt.event.KeyEvent;

public interface IOrionGraphicsMouseListener
{
	public abstract void onRightClick(IMouseInfo pMouseInfo);

	public abstract void onMiddleClick(IMouseInfo pMouseInfo);

	public abstract void onLeftClick(IMouseInfo pMouseInfo);

	public abstract void onRightPress(IMouseInfo pMouseInfo);

	public abstract void onMiddlePress(IMouseInfo pMouseInfo);

	public abstract void onLeftPress(IMouseInfo pMouseInfo);

	public abstract void onMove(IMouseInfo pMouseInfo);

	public abstract void onWheel(IMouseInfo pMouseInfo);

	public abstract void onKeyTyped(KeyEvent pKeyEvent);

	public abstract void onKeyPressed(KeyEvent pKeyEvent);

}
