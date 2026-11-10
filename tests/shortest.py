"""Independent exhaustive 1/3-ply lower bound for the five-ply teaching position.
No engine heuristics, candidate pruning, or shared JavaScript implementation.
"""
def point(s):
    return (15-int(s[1:]))*15+ord(s[0])-65

def wins(b,i,c):
    x,y=i%15,i//15
    for dx,dy in [(1,0),(0,1),(1,1),(1,-1)]:
        count=1
        for sign in [-1,1]:
            xx,yy=x+sign*dx,y+sign*dy
            while 0<=xx<15 and 0<=yy<15 and b[yy*15+xx]==c:
                count+=1;xx+=sign*dx;yy+=sign*dy
        if count>=5:return True
    return False

def win_points(b,c):
    result=[]
    for i in range(225):
        if b[i]:continue
        b[i]=c
        if wins(b,i,c):result.append(i)
        b[i]=0
    return result

b=[0]*225
for s in 'H6 H7 H9 G8 I8'.split():b[point(s)]=1
for s in 'H5 A1 C1 E1 A3'.split():b[point(s)]=2
assert not win_points(b,1)
black_candidates=0;white_replies=0;forced_three=[]
for a in range(225):
    if b[a]:continue
    black_candidates+=1;b[a]=1
    forced=True
    for d in range(225):
        if b[d]:continue
        white_replies+=1;b[d]=2
        if wins(b,d,2) or not win_points(b,1):
            forced=False;b[d]=0;break
        b[d]=0
    if forced:forced_three.append(a)
    b[a]=0
assert not forced_three
# Upper bound: the first four forces H10; the next open four beats every reply.
b[point('H8')]=1
for d in range(225):
    if b[d]:continue
    b[d]=2
    assert not wins(b,d,2)
    if d!=point('H10'):
        assert win_points(b,1)
    else:
        b[point('F8')]=1
        for e in range(225):
            if b[e]:continue
            b[e]=2
            assert not wins(b,e,2)
            assert win_points(b,1)
            b[e]=0
        b[point('F8')]=0
    b[d]=0
print(f'Independent Python proof: {black_candidates} black first moves; {white_replies} defense witnesses.')
print('No forced win within 1 or 3 plies; a forced win within 5 plies. Distance = 5 for this teaching position only.')
