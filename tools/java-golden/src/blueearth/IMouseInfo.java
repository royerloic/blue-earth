/**
 * Created on 26 avr. 2005 By Dipl.-Inf. MSC. Ing. Loic Royer
 * 
 */
package blueearth;

public interface IMouseInfo
{
	public abstract int getMouseX();

	public abstract int getMouseY();

	public abstract int getMouseDeltaZ();

	public abstract boolean getMouseLeft();

	public abstract boolean getMouseMiddle();

	public abstract boolean getMouseRight();

	public abstract boolean getCtrl();

	public abstract boolean getAlt();

	public abstract boolean getShift();
}
